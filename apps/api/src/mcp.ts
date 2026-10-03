import { hashKey } from "./keys";
import { performExecute } from "./execute-request";
import type { AppDeps } from "./app";

/**
 * MCP endpoint for Cursor, Claude, and other agents.
 * Uses the official SDK's server and the streamable HTTP transport.
 * The bearer key is a hashed workspace key. Schemas come from the same registry as chat.
 */
export async function handleMcp(request: Request, deps: AppDeps): Promise<Response> {
  const header = request.headers.get("authorization");
  if (!header) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rawKey = header.replace(/^Bearer\s+/i, "");
  const found = await deps.store.findAgentKey(hashKey(rawKey));
  if (!found) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const replay = await replayMcp(request);
  await deps.store.touchAgentKey(hashKey(rawKey), replay.client);

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

  const server = new McpServer({ name: "loopai", version: "0.1.0" });
  const accounts = await deps.store.listAccounts(found.workspaceId);
  for (const toolkit of deps.toolkits) {
    const rows = toolkit.authType === "none" ? [null] : accounts.filter((account) => account.toolkitSlug === toolkit.slug);
    for (const account of rows) {
      for (const action of toolkit.actions) {
        if (action.confirm && !found.scopes.includes("write")) continue;
        const name = account ? `${toolkit.slug}__${action.slug}__${account.id.replace(/-/g, "").slice(0, 8)}` : `${toolkit.slug}__${action.slug}`;
        server.registerTool(
          name,
          { description: action.description, inputSchema: action.schema as import("zod").ZodTypeAny },
          async (args: Record<string, unknown>) => {
            const outcome = await performExecute(deps, {
              workspaceId: found.workspaceId,
              toolkit: toolkit.slug,
              action: action.slug,
              args,
              connectedAccountId: account?.id ?? null,
              confirmed: found.scopes.includes("write"),
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(outcome.body.result ?? { error: outcome.body.error }) }],
              isError: outcome.http >= 400,
            };
          },
        );
      }
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(replay.request);
}

export function clientFromMcpBody(raw: string): { name: string; version: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  let client: { name: string; version: string | null } | null = null;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const method = (message as { method?: unknown }).method;
    const params = (message as { params?: { clientInfo?: { name?: unknown; version?: unknown } } }).params;
    if (method !== "initialize" || !params?.clientInfo) continue;
    const name = cleanLabel(params.clientInfo.name, 80);
    if (!name) continue;
    client = { name, version: cleanLabel(params.clientInfo.version, 40) };
  }
  return client;
}

function cleanLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
  return text || null;
}

async function replayMcp(request: Request): Promise<{ request: Request; client: { name: string; version: string | null } | null }> {
  if (request.method === "GET" || request.method === "HEAD") return { request, client: null };
  const raw = await request.text();
  return {
    request: new Request(request.url, { method: request.method, headers: request.headers, body: raw }),
    client: clientFromMcpBody(raw),
  };
}
