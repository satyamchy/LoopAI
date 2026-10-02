import { randomBytes } from "node:crypto";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AccountScope, Toolkit } from "@loopai/core";
import { secretStrings } from "@loopai/core";
import { authorizeUrl, exchangeCode, listCards } from "@loopai/toolkits";
import { mountAuth, userFromCookie } from "./auth-routes";
import { performExecute } from "./execute-request";
import { buildExport, tableFromResult, type ExportFormat } from "./export-file";
import { hashKey, newAgentKey } from "./keys";
import { handleMcp } from "./mcp";
import { openApiDocument } from "./openapi";
import { modelProviders, providerBaseUrl, runToolLoop } from "./run-tool-loop";
import type { Store } from "./store";

export type AppDeps = {
  store: Store;
  toolkits: Toolkit[];
  publicUrl: string;
  webOrigin: string;
  fetchImpl?: typeof fetch;
};

/** HTTP API. The web app, chat, and MCP all enter through here. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const fetchImpl = deps.fetchImpl ?? fetch;
  app.use("*", cors({ origin: deps.webOrigin, allowHeaders: ["content-type", "authorization", "idempotency-key"], credentials: true }));
  mountAuth(app, deps);

  app.get("/openapi.json", (c) => c.json(openApiDocument));
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/workspace", async (c) => {
    const workspace = await deps.store.ensureWorkspace();
    return c.json(workspace);
  });

  app.get("/v1/toolkits", (c) => c.json({ toolkits: listCards(deps.toolkits) }));

  app.get("/v1/providers", (c) => c.json({ providers: modelProviders }));

  app.get("/v1/connections", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    return c.json({ connections: await deps.store.listAccounts(workspace.id) });
  });

  app.post("/v1/connections", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json();
    const toolkit = deps.toolkits.find((item) => item.slug === body.toolkit);
    if (!toolkit || toolkit.authType !== "api_key") return c.json({ error: "This app does not take an API key." }, 400);
    const credentials = readCredentials(body, toolkit);
    if (credentials instanceof Response) return credentials;
    const account = await deps.store.insertAccount({
      workspaceId: workspace.id,
      toolkitSlug: toolkit.slug,
      scope: scopeOf(body.scope),
      externalLabel: typeof body.label === "string" ? body.label : toolkit.displayName,
      expiresAt: null,
      encryptedCredentials: await deps.store.encrypt(credentials),
    });
    return c.json(account);
  });

  app.post("/v1/connections/start", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
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
      if (!existing || existing.workspaceId !== workspace.id || existing.toolkitSlug !== toolkit.slug) {
        return c.json({ error: "That connected account was not found." }, 404);
      }
    }
    const state = randomBytes(16).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    await deps.store.insertOAuthState({
      state,
      workspaceId: workspace.id,
      toolkitSlug: toolkit.slug,
      codeVerifierEncrypted: await deps.store.encrypt({ verifier: codeVerifier, reconnectAccountId }),
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
      const decoded = await deps.store.decrypt(saved.codeVerifierEncrypted);
      const verifier = typeof decoded === "string" ? decoded : String((decoded as { verifier?: string }).verifier ?? "");
      const reconnectAccountId = typeof decoded === "object" && decoded ? (decoded as { reconnectAccountId?: string | null }).reconnectAccountId ?? null : null;
      if (!verifier) return failed(toolkit.slug);
      const tokens = await exchangeCode(toolkit.oauth, {
        code,
        redirectUri: oauthRedirect(deps.publicUrl, toolkit),
        codeVerifier: verifier,
      });
      const encryptedCredentials = await deps.store.encrypt({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      });
      if (reconnectAccountId) {
        const existing = await deps.store.getAccount(reconnectAccountId);
        if (!existing || existing.workspaceId !== saved.workspaceId) return failed(toolkit.slug);
        await deps.store.updateAccountCredentials(existing.id, encryptedCredentials, tokens.expires_at, tokens.label);
      } else {
        await deps.store.insertAccount({
          workspaceId: saved.workspaceId,
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
    const removed = await deps.store.deleteAccount(workspace.id, c.req.param("id"));
    if (!removed) return c.json({ error: "Connected account not found." }, 404);
    return c.json({ ok: true });
  });

  app.post("/v1/tools/execute", async (c) => {
    const workspace = await workspaceFrom(c, deps.store);
    if (workspace instanceof Response) return workspace;
    const body = await c.req.json();
    const outcome = await performExecute(deps, {
      workspaceId: workspace.id,
      toolkit: String(body.toolkit ?? ""),
      action: String(body.action ?? ""),
      args: body.arguments,
      connectedAccountId: body.connectedAccountId ?? null,
      idempotencyKey: c.req.header("idempotency-key") ?? body.idempotencyKey ?? null,
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
      encryptedApiKey: await deps.store.encrypt({ apiKey: body.apiKey }),
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
    const decrypted = (await deps.store.decrypt(llm.encryptedApiKey)) as { apiKey?: string };
    if (!decrypted.apiKey) return c.json({ error: "The model key could not be read." }, 400);
    const accounts = await deps.store.listAccounts(workspace.id);
    const secrets = [decrypted.apiKey];
    for (const account of accounts) {
      const row = await deps.store.getAccount(account.id);
      if (row) secrets.push(...secretStrings(await deps.store.decrypt(row.encryptedCredentials)));
    }
    const bindings = bindTools(deps.toolkits, accounts);
    const downloads: { id: string; tool: string; tabular: boolean }[] = [];
    const requested = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
    const conversationId = requested ?? (await deps.store.createConversation(workspace.id, body.message.slice(0, 80))).id;
    const conversation = await deps.store.getConversation(conversationId);
    if (!conversation || conversation.workspaceId !== workspace.id) return c.json({ error: "Conversation not found." }, 404);
    await deps.store.insertMessage(conversationId, "user", body.message);
    const history = await deps.store.listMessages(conversationId);
    try {
      const result = await runToolLoop({
        endpoint: `${providerBaseUrl(llm.provider, llm.baseUrl)}/chat/completions`,
        apiKey: decrypted.apiKey,
        model: llm.model,
        history,
        tools: bindings.tools,
        fetchImpl,
        secrets,
        callTool: async (name, args) => {
          const binding = bindings.byName.get(name);
          if (!binding) throw new Error(`Unknown tool ${name}`);
          const outcome = await performExecute(deps, { workspaceId: workspace.id, ...binding, args });
          if (outcome.http >= 400) throw new Error(String(outcome.body.error ?? "Tool failed"));
          if (typeof outcome.body.id === "string") {
            downloads.push({ id: outcome.body.id, tool: binding.toolkit, tabular: tableFromResult(outcome.body.result) !== null });
          }
          return outcome.body.result;
        },
      });
      const reply = String(redactText(result.text, secrets));
      await deps.store.insertMessage(conversationId, "assistant", reply);
      return c.json({ conversationId, reply, tools: result.toolsUsed, downloads });
    } catch (error) {
      const safe = redactText(error instanceof Error ? error.message : "Chat failed", secrets).slice(0, 300);
      await deps.store.insertMessage(conversationId, "assistant", safe);
      return c.json({ error: safe, conversationId }, 502);
    }
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
    const body = await c.req.json().catch(() => ({ name: "Cursor" }));
    const key = newAgentKey();
    const saved = await deps.store.insertAgentKey({
      workspaceId: workspace.id,
      name: typeof body.name === "string" && body.name ? body.name : "Agent",
      keyHash: hashKey(key),
      keyPrefix: key.slice(0, 12),
    });
    return c.json({ id: saved.id, key, mcpUrl: `${deps.publicUrl}/mcp` });
  });

  app.all("/mcp", (c) => handleMcp(c.req.raw, deps));

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

async function workspaceFrom(c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status?: number) => Response }, store: Store) {
  const header = c.req.header("authorization");
  if (header) {
    const found = await store.findAgentKey(hashKey(header.replace(/^Bearer\s+/i, "")));
    if (!found) return c.json({ error: "Unauthorized" }, 401);
    const workspace = await store.ensureWorkspace();
    return { id: found.workspaceId, name: workspace.name };
  }
  const user = await userFromCookie(c.req.header("cookie"), store);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return { id: user.workspaceId, name: user.displayName };
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

function bindTools(toolkits: Toolkit[], accounts: { id: string; toolkitSlug: string; status: string; externalLabel: string | null }[]) {
  const byName = new Map<string, { toolkit: string; action: string; connectedAccountId: string | null }>();
  const tools: { name: string; description: string; parameters: Record<string, unknown> }[] = [];
  for (const toolkit of toolkits) {
    const rows = toolkit.authType === "none" ? [null] : accounts.filter((account) => account.toolkitSlug === toolkit.slug && account.status === "active");
    for (const account of rows) {
      for (const action of toolkit.actions) {
        const name = account ? `${toolkit.slug}__${action.slug}__${account.id.replace(/-/g, "").slice(0, 8)}` : `${toolkit.slug}__${action.slug}`;
        byName.set(name, { toolkit: toolkit.slug, action: action.slug, connectedAccountId: account?.id ?? null });
        tools.push({
          name,
          description: account?.externalLabel ? `${action.description} Account: ${account.externalLabel}.` : action.description,
          parameters: action.parameters,
        });
      }
    }
  }
  return { byName, tools };
}

function redactText(text: string, secrets: string[]): string {
  return secrets.filter((secret) => secret.length >= 8).reduce((current, secret) => current.split(secret).join("[redacted]"), text);
}
