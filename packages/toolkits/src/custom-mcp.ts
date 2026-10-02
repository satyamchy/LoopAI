import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Call an MCP server LoopAI does not ship. Connect with its HTTP URL.
 * A bearer token is optional. Localhost is allowed. Cloud metadata hosts are not.
 */
const INIT = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "loopai", version: "0.1.0" },
};

export const customMcp: Toolkit = {
  slug: "custom-mcp",
  displayName: "Custom MCP",
  description: "Call tools on an MCP server you host.",
  authType: "api_key",
  credentialFields: [
    { key: "serverUrl", label: "Server URL", secret: false },
    { key: "bearerToken", label: "Bearer token", optional: true },
  ],
  actions: [
    defineAction({
      slug: "list_tools",
      description: "List tools the MCP server exposes. Returns name and description.",
      risk: "read",
      input: z.object({}),
      async run(_args, _token, credentials) {
        const result = await withSession(credentials, (call) => call("tools/list", {}, 3));
        const tools = Array.isArray((result as { tools?: unknown }).tools) ? (result as { tools: unknown[] }).tools : [];
        return {
          tools: tools.slice(0, 40).map((tool) => {
            const row = tool as { name?: unknown; description?: unknown };
            return {
              name: typeof row.name === "string" ? row.name : "",
              description: typeof row.description === "string" ? row.description : "",
            };
          }),
        };
      },
    }),
    defineAction({
      slug: "call_tool",
      description: "Call one tool by the name list_tools returned.",
      risk: "write",
      input: z.object({
        name: z.string().min(1).max(120),
        arguments: z.record(z.unknown()).optional(),
      }),
      async run(args, _token, credentials) {
        const result = await withSession(credentials, (call) => call("tools/call", { name: args.name, arguments: args.arguments ?? {} }, 3));
        return stripSecret(result, bearerOf(credentials));
      },
    }),
  ],
};

export function assertMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MCP server URL is not valid.");
  }
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("MCP server URL must be http or https.");
  }
  if (host === "169.254.169.254" || host === "metadata.google.internal" || host === "fd00:ec2::254") {
    throw new Error("That MCP host is not allowed.");
  }
  return url;
}

type Session = { id: string | null };
type Rpc = (method: string, params: unknown, id: number) => Promise<unknown>;

async function withSession(credentials: Record<string, unknown> | undefined, run: (call: Rpc) => Promise<unknown>): Promise<unknown> {
  const serverUrl = assertMcpUrl(typeof credentials?.serverUrl === "string" ? credentials.serverUrl : "").toString();
  const bearer = bearerOf(credentials);
  const session: Session = { id: null };
  const opened = await post(serverUrl, bearer, session, { jsonrpc: "2.0", id: 1, method: "initialize", params: INIT });
  const initBody = await readBody(opened);
  if (initBody.error) throw new Error("MCP server rejected the call.");
  const noted = await post(serverUrl, bearer, session, { jsonrpc: "2.0", method: "notifications/initialized" });
  await noted.text().catch(() => "");
  return run((method, params, id) => call(serverUrl, bearer, session, method, params, id));
}

async function call(serverUrl: string, bearer: string | null, session: Session, method: string, params: unknown, id: number): Promise<unknown> {
  const response = await post(serverUrl, bearer, session, { jsonrpc: "2.0", id, method, params });
  const body = await readBody(response);
  if (body.error) throw new Error("MCP server rejected the call.");
  return body.result ?? {};
}

function bearerOf(credentials: Record<string, unknown> | undefined): string | null {
  const value = credentials?.bearerToken;
  return typeof value === "string" && value ? value : null;
}

async function post(serverUrl: string, bearer: string | null, session: Session, body: unknown): Promise<Response> {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json, text/event-stream");
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (session.id) headers.set("mcp-session-id", session.id);
  let response: Response;
  try {
    response = await fetch(serverUrl, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("MCP server could not be reached.");
  }
  const next = response.headers.get("mcp-session-id");
  if (next) session.id = next;
  if (!response.ok && response.status !== 202) throw new Error(`MCP server returned ${response.status}`);
  return response;
}

async function readBody(response: Response): Promise<{ result?: unknown; error?: unknown }> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text) return {};
  const json = type.includes("text/event-stream") ? lastEvent(text) : text;
  try {
    return JSON.parse(json) as { result?: unknown; error?: unknown };
  } catch {
    throw new Error("MCP server returned a response that was not JSON.");
  }
}

function lastEvent(text: string): string {
  const lines = [...text.matchAll(/^data: (.+)$/gm)].map((match) => match[1]).filter((line) => line !== "[DONE]");
  const last = lines.at(-1);
  if (!last) throw new Error("MCP server returned an empty stream.");
  return last;
}

function stripSecret(value: unknown, secret: string | null): unknown {
  if (!secret) return value;
  const text = JSON.stringify(value);
  if (!text?.includes(secret)) return value;
  return JSON.parse(text.split(secret).join("[redacted]"));
}
