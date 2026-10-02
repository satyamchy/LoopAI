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
  const found = await deps.store.findAgentKey(hashKey(header.replace(/^Bearer\s+/i, "")));
  if (!found) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

  const server = new McpServer({ name: "loopai", version: "0.1.0" });
  const accounts = await deps.store.listAccounts(found.workspaceId);
  for (const toolkit of deps.toolkits) {
    const rows = toolkit.authType === "none" ? [null] : accounts.filter((account) => account.toolkitSlug === toolkit.slug);
    for (const account of rows) {
      for (const action of toolkit.actions) {
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
  return transport.handleRequest(request);
}
