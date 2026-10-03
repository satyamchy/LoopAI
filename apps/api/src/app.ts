import { randomBytes } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { AccountScope, Toolkit } from "@loopai/core";
import { authorizeUrl, exchangeCode, listCards } from "@loopai/toolkits";
import { mountAuth, userFromCookie } from "./auth-routes";
import { confirmChat, runChat } from "./chat-turn";
import { performExecute } from "./execute-request";
import { buildExport, tableFromResult, type ExportFormat } from "./export-file";
import { hashKey, newAgentKey } from "./keys";
import { handleMcp } from "./mcp";
import { openApiDocument } from "./openapi";
import { allow, clientIp } from "./rate-limit";
import { modelProviders, providerBaseUrl } from "./run-tool-loop";
import type { DeleteActor, Store } from "./store";

export type AppDeps = {
  store: Store;
  toolkits: Toolkit[];
  publicUrl: string;
  webOrigin: string;
  fetchImpl?: typeof fetch;
  webDist?: string | null;
};

/** HTTP API. The web app, chat, and MCP all enter through here. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: deps.webOrigin, allowHeaders: ["content-type", "authorization", "idempotency-key"], credentials: true }));
  mountAuth(app, deps);

  app.get("/openapi.json", (c) => c.json(openApiDocument));
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/workspace", async (c) => {
    const access = await workspaceFrom(c, deps.store);
    if (access instanceof Response) return access;
    return c.json({ id: access.id, role: access.role });
  });

  app.get("/v1/toolkits", (c) => c.json({ toolkits: listCards(deps.toolkits) }));

  app.get("/v1/providers", (c) => c.json({ providers: modelProviders }));

  app.get("/v1/connections", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ connections: await deps.store.listAccounts(workspace.id) });
  });

  app.post("/v1/connections", async (c) => {
    const access = await workspaceFrom(c, deps.store);
    if (access instanceof Response) return access;
    const body = await c.req.json();
    const toolkit = deps.toolkits.find((item) => item.slug === body.toolkit);
    if (!toolkit || toolkit.authType !== "api_key") return c.json({ error: "This app does not take an API key." }, 400);
    const credentials = readCredentials(body, toolkit);
    if (credentials instanceof Response) return credentials;
    const account = await deps.store.insertAccount({
      workspaceId: access.id,
      toolkitSlug: toolkit.slug,
      scope: scopeOf(body.scope),
      externalLabel: typeof body.label === "string" ? body.label : toolkit.displayName,
      expiresAt: null,
      createdBy: access.userId,
      encryptedCredentials: await deps.store.encrypt(access.id, credentials),
    });
    return c.json(account);
  });

  app.post("/v1/connections/start", async (c) => {
    const access = await workspaceFrom(c, deps.store);
    if (access instanceof Response) return access;
    const body = await c.req.json();
    const toolkit = deps.toolkits.find((item) => item.slug === body.toolkit);
    if (!toolkit?.oauth) return c.json({ error: "This app does not use OAuth." }, 400);
    const clientId = process.env[toolkit.oauth.clientIdEnv];
    if (!clientId || !process.env[toolkit.oauth.clientSecretEnv]) {
      return c.json({ error: `Set ${toolkit.oauth.clientIdEnv} and ${toolkit.oauth.clientSecretEnv} in the API environment, then restart the API.` }, 400);
    }
    const reconnectAccountId = typeof body.accountId === "string" ? body.accountId : null;
    if (reconnectAccountId) {
      const existing = await deps.store.getAccount(reconnectAccountId);
      if (!existing || existing.workspaceId !== access.id || existing.toolkitSlug !== toolkit.slug) {
        return c.json({ error: "That connected account was not found." }, 404);
      }
    }
    const state = randomBytes(16).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    await deps.store.insertOAuthState({
      state,
      workspaceId: access.id,
      toolkitSlug: toolkit.slug,
      codeVerifierEncrypted: await deps.store.encrypt(access.id, { verifier: codeVerifier, reconnectAccountId }),
      scope: scopeOf(body.scope),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const url = authorizeUrl(toolkit.oauth, {
      clientId,
      redirectUri: oauthRedirect(deps.publicUrl, toolkit),
      state,
      codeVerifier,
    });
    return c.json({ url });
  });

  app.get("/v1/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const failed = (slug?: string) => c.redirect(`${deps.webOrigin}/connect/apps${slug ? `/${slug}` : ""}?error=oauth`);
    if (!code || !state || c.req.query("error")) return failed();
    const saved = await deps.store.takeOAuthState(state);
    const toolkit = deps.toolkits.find((item) => item.slug === saved?.toolkitSlug);
    if (!saved || !toolkit?.oauth) return failed(saved?.toolkitSlug);
    try {
      const decoded = await deps.store.decrypt(saved.workspaceId, saved.codeVerifierEncrypted);
      const verifier = typeof decoded === "string" ? decoded : String((decoded as { verifier?: string }).verifier ?? "");
      const reconnectAccountId = typeof decoded === "object" && decoded ? (decoded as { reconnectAccountId?: string | null }).reconnectAccountId ?? null : null;
      if (!verifier || !saved.workspaceId) return failed(toolkit.slug);
      const workspaceId = saved.workspaceId;
      const tokens = await exchangeCode(toolkit.oauth, {
        code,
        redirectUri: oauthRedirect(deps.publicUrl, toolkit),
        codeVerifier: verifier,
      });
      const encryptedCredentials = await deps.store.encrypt(workspaceId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      });
      if (reconnectAccountId) {
        const existing = await deps.store.getAccount(reconnectAccountId);
        if (!existing || existing.workspaceId !== workspaceId) return failed(toolkit.slug);
        await deps.store.updateAccountCredentials(existing.id, encryptedCredentials, tokens.expires_at, tokens.label);
      } else {
        await deps.store.insertAccount({
          workspaceId,
          toolkitSlug: toolkit.slug,
          scope: saved.scope,
          externalLabel: tokens.label,
          expiresAt: tokens.expires_at,
          encryptedCredentials,
        });
      }
      return c.redirect(`${deps.webOrigin}/connect/apps/${toolkit.slug}?connected=1`);
    } catch {
      return failed(toolkit.slug);
    }
  });

  app.delete("/v1/connections/:id", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const removed = await deps.store.deleteAccount(workspace.id, c.req.param("id"), actorOf(workspace));
    if (removed === "forbidden") return c.json({ error: "You cannot delete that connection." }, 403);
    if (removed === "missing") return c.json({ error: "Connected account not found." }, 404);
    return c.json({ ok: true });
  });

  app.get("/v1/executions", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ executions: await deps.store.listExecutions(workspace.id) });
  });

  app.post("/v1/tools/execute", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    if (!(await allow(`execute:${workspace.id}:${clientIp(c.req.header("x-forwarded-for"))}`, 60, 60_000))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    const body = await c.req.json();
    const outcome = await performExecute(deps, {
      workspaceId: workspace.id,
      toolkit: String(body.toolkit ?? ""),
      action: String(body.action ?? ""),
      args: body.arguments,
      connectedAccountId: body.connectedAccountId ?? null,
      idempotencyKey: c.req.header("idempotency-key") ?? body.idempotencyKey ?? null,
      confirmed: workspace.confirmed,
    });
    return c.json(outcome.body, outcome.http as 200);
  });

  app.get("/v1/conversations", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ conversations: await deps.store.listConversations(workspace.id) });
  });

  app.get("/v1/conversations/:id/messages", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const conversation = await deps.store.getConversation(c.req.param("id"));
    if (!conversation || conversation.workspaceId !== workspace.id) return c.json({ error: "Conversation not found." }, 404);
    return c.json({ messages: await deps.store.listMessages(conversation.id) });
  });

  app.delete("/v1/conversations/:id", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const conversation = await deps.store.getConversation(c.req.param("id"));
    if (!conversation || conversation.workspaceId !== workspace.id) return c.json({ error: "Conversation not found." }, 404);
    await deps.store.deleteConversation(conversation.id);
    return c.json({ ok: true });
  });

  app.get("/v1/llm-connections", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ connections: await deps.store.listLlms(workspace.id) });
  });

  app.post("/v1/llm-connections", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json();
    if (typeof body.apiKey !== "string" || body.apiKey.length < 8) return c.json({ error: "API key must be at least 8 characters." }, 400);
    if (typeof body.model !== "string" || !body.model) return c.json({ error: "Model is required." }, 400);
    const provider = typeof body.provider === "string" ? body.provider : "openai";
    const baseUrl = typeof body.baseUrl === "string" && body.baseUrl ? body.baseUrl : null;
    try {
      providerBaseUrl(provider, baseUrl);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Provider is invalid." }, 400);
    }
    const saved = await deps.store.insertLlm({
      workspaceId: workspace.id,
      provider,
      model: body.model,
      baseUrl,
      encryptedApiKey: await deps.store.encrypt(workspace.id, { apiKey: body.apiKey }),
    });
    return c.json(saved);
  });

  app.post("/v1/chat", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json();
    if (typeof body.message !== "string" || !body.message.trim()) return c.json({ error: "Message is required." }, 400);
    const llm = await deps.store.getLlm(String(body.llmConnectionId ?? ""));
    if (!llm || !(await deps.store.listLlms(workspace.id)).some((item) => item.id === llm.id)) {
      return c.json({ error: "Connect a model first." }, 400);
    }
    if (!(await allow(`chat:${workspace.id}:${clientIp(c.req.header("x-forwarded-for"))}`, 30, 60_000))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    if (body.stream === true) {
      return streamSSE(c, async (stream) => {
        const outcome = await runChat(deps, workspace.id, body, (text) => {
          void stream.writeSSE({ event: "delta", data: JSON.stringify(text) });
        });
        if (outcome.body.pending) await stream.writeSSE({ event: "pending", data: JSON.stringify(outcome.body.pending) });
        await stream.writeSSE({ event: "done", data: JSON.stringify(outcome.body) });
      });
    }
    const outcome = await runChat(deps, workspace.id, body);
    return c.json(outcome.body, outcome.http as 200);
  });

  app.post("/v1/chat/confirm", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json().catch(() => ({}));
    if (body.stream === true) {
      return streamSSE(c, async (stream) => {
        const outcome = await confirmChat(deps, workspace.id, body, (text) => {
          void stream.writeSSE({ event: "delta", data: JSON.stringify(text) });
        });
        await stream.writeSSE({ event: "done", data: JSON.stringify(outcome.body) });
      });
    }
    const outcome = await confirmChat(deps, workspace.id, body);
    return c.json(outcome.body, outcome.http as 200);
  });

  app.post("/v1/exports", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json().catch(() => ({}));
    const format = body.format;
    if (format !== "pdf" && format !== "xlsx" && format !== "docx") {
      return c.json({ error: "Format must be pdf, xlsx, or docx." }, 400);
    }
    let title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "LoopAI";
    let text = typeof body.text === "string" ? body.text.slice(0, 20_000) : "";
    let table = null as ReturnType<typeof tableFromResult>;
    if (typeof body.executionId === "string" && body.executionId) {
      const row = await deps.store.getExecution(workspace.id, body.executionId);
      if (!row || row.status !== "succeeded") return c.json({ error: "That result was not found." }, 404);
      title = `${row.toolkitSlug} ${row.action}`;
      table = tableFromResult(row.resultRedacted);
      text = table ? "" : JSON.stringify(row.resultRedacted ?? {}, null, 2).slice(0, 20_000);
    }
    if (format === "xlsx" && !table && !text) return c.json({ error: "This result is not a table." }, 400);
    const file = await buildExport({ format: format as ExportFormat, title, text, table });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename}"`,
      },
    });
  });

  app.get("/v1/agent-keys", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ keys: await deps.store.listAgentKeys(workspace.id), mcpUrl: `${deps.publicUrl}/mcp` });
  });

  app.post("/v1/agent-keys", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    if (workspace.role !== "owner") return c.json({ error: "Only an owner can create an agent key." }, 403);
    const body = await c.req.json().catch(() => ({ name: "Cursor" }));
    const scopes = body.write === true ? "read,write" : "read";
    const days = body.expiresInDays;
    const expiresAt = days === 7 || days === 30 || days === 90 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
    const key = newAgentKey();
    const saved = await deps.store.insertAgentKey({
      workspaceId: workspace.id,
      name: typeof body.name === "string" && body.name ? body.name : "Agent",
      keyHash: hashKey(key),
      keyPrefix: key.slice(0, 12),
      scopes,
      expiresAt,
    });
    return c.json({ id: saved.id, key, mcpUrl: `${deps.publicUrl}/mcp`, scopes, expiresAt });
  });

  app.all("/mcp", (c) => handleMcp(c.req.raw, deps));

  if (deps.webDist) {
    const root = resolve(deps.webDist);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };
    app.use("*", async (c, next) => {
      const path = c.req.path;
      if (path.startsWith("/v1") || path.startsWith("/mcp") || path === "/docs" || path === "/openapi.json") return next();
      const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
      const file = resolve(join(root, rel));
      if (!file.startsWith(root)) return c.notFound();
      try {
        const bytes = await readFile(file);
        return c.body(bytes, 200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      } catch {
        try {
          const html = await readFile(join(root, "index.html"));
          return c.body(html, 200, { "content-type": "text/html; charset=utf-8" });
        } catch {
          return next();
        }
      }
    });
  }

  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
    const text = err instanceof Error ? `${err.message} ${err.cause instanceof Error ? err.cause.message : ""}` : "";
    console.error(text.slice(0, 300) || "Request failed");
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timeout|connect/i.test(text)) {
      return c.json({ error: "Database unreachable. DATABASE_URL is not resolving. Use the Supabase pooler host, not the direct db host." }, 500);
    }
    return c.json({ error: "Request failed" }, 500);
  });

  return app;
}

type Access = { id: string; role: "owner" | "member" | "agent"; userId: string | null; confirmed: boolean };

async function workspaceFrom(c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status?: number) => Response }, store: Store): Promise<Access | Response> {
  const header = c.req.header("authorization");
  if (header) {
    const found = await store.findAgentKey(hashKey(header.replace(/^Bearer\s+/i, "")));
    if (!found) return c.json({ error: "Unauthorized" }, 401);
    return { id: found.workspaceId, role: "agent", userId: null, confirmed: found.scopes.includes("write") };
  }
  const user = await userFromCookie(c.req.header("cookie"), store);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return { id: user.workspaceId, role: user.role, userId: user.userId, confirmed: false };
}

function actorOf(access: Access): DeleteActor {
  return { userId: access.userId, role: access.role };
}

function readCredentials(body: { secret?: unknown; credentials?: unknown }, toolkit: Toolkit): Record<string, string> | Response {
  const fields = toolkit.credentialFields ?? [{ key: "secret", label: "Secret" }];
  const credentials: Record<string, string> = {};
  if (typeof body.secret === "string") credentials.secret = body.secret;
  if (body.credentials && typeof body.credentials === "object") {
    for (const [key, value] of Object.entries(body.credentials as Record<string, unknown>)) {
      if (typeof value === "string") credentials[key] = value;
    }
  }
  const stored: Record<string, string> = {};
  for (const field of fields) {
    const value = credentials[field.key];
    if (field.optional && !value) continue;
    if (field.secret === false) {
      if (!value || value.trim() === "") return Response.json({ error: `${field.label} is required.` }, { status: 400 });
    } else if (!value || value.length < 8) {
      return Response.json({ error: `${field.label} must be at least 8 characters.` }, { status: 400 });
    }
    stored[field.key] = value;
  }
  return stored;
}

function oauthRedirect(publicUrl: string, toolkit: Toolkit): string {
  return toolkit.oauth?.redirectUri ?? `${publicUrl}/v1/oauth/callback`;
}

function scopeOf(value: unknown): AccountScope {
  return value === "workspace" ? "workspace" : "user";
}

