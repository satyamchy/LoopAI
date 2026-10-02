import { ZodError } from "zod";
import { redact, secretStrings, type Toolkit } from "@loopai/core";
import { executeToolkit, refreshAccessToken } from "@loopai/toolkits";
import { singleFlight } from "./single-flight";
import type { Store } from "./store";

export type ExecuteInput = {
  workspaceId: string;
  toolkit: string;
  action: string;
  args: unknown;
  connectedAccountId?: string | null;
  idempotencyKey?: string | null;
};

type Deps = { store: Store; toolkits: Toolkit[] };

/**
 * Run one tool for a workspace. Chat, MCP, and POST /v1/tools/execute all use this.
 * The returned result is already redacted.
 */
export async function performExecute(deps: Deps, input: ExecuteInput): Promise<{ http: number; body: Record<string, unknown> }> {
  const toolkit = deps.toolkits.find((item) => item.slug === input.toolkit);
  if (!toolkit) return { http: 404, body: { error: `Unknown toolkit ${input.toolkit}` } };

  if (input.idempotencyKey) {
    const previous = await deps.store.findExecution(input.workspaceId, input.idempotencyKey);
    if (previous) {
      return {
        http: previous.status === "succeeded" ? 200 : 400,
        body: { id: previous.id, status: previous.status, result: previous.resultRedacted, error: previous.errorCode },
      };
    }
  }

  const account = await resolveAccount(deps.store, toolkit, input);
  if ("http" in account) return account;

  const started = Date.now();
  let credentials: Record<string, unknown> = {};
  if (account.row) {
    credentials = (await deps.store.decrypt(account.row.encryptedCredentials)) as Record<string, unknown>;
    credentials = await refreshIfNeeded(deps.store, toolkit, account.row.id, credentials);
  }
  const secrets = secretStrings(credentials);

  try {
    const result = await executeToolkit(toolkit, input.action, input.args ?? {}, credentials);
    const redacted = redact(result, secrets);
    const saved = await deps.store.insertExecution({
      workspaceId: input.workspaceId,
      connectedAccountId: account.row?.id ?? null,
      toolkitSlug: toolkit.slug,
      action: input.action,
      idempotencyKey: input.idempotencyKey ?? null,
      argsRedacted: redact(input.args ?? {}, secrets),
      resultRedacted: redacted,
      status: "succeeded",
      latencyMs: Date.now() - started,
      errorCode: null,
    });
    return { http: 200, body: { id: saved.id, status: "succeeded", result: redacted } };
  } catch (error) {
    const invalid = error instanceof ZodError;
    const message = invalid ? "Invalid arguments" : error instanceof Error ? String(redact(error.message, secrets)) : "Tool failed";
    const saved = await deps.store.insertExecution({
      workspaceId: input.workspaceId,
      connectedAccountId: account.row?.id ?? null,
      toolkitSlug: toolkit.slug,
      action: input.action,
      idempotencyKey: input.idempotencyKey ?? null,
      argsRedacted: redact(input.args ?? {}, secrets),
      resultRedacted: null,
      status: "failed",
      latencyMs: Date.now() - started,
      errorCode: message,
    });
    return {
      http: invalid ? 400 : 502,
      body: { id: saved.id, status: "failed", error: message, fields: invalid ? error.issues.map((issue) => issue.path.join(".")) : undefined },
    };
  }
}

async function resolveAccount(
  store: Store,
  toolkit: Toolkit,
  input: ExecuteInput,
): Promise<{ row: Awaited<ReturnType<Store["getAccount"]>> } | { http: number; body: Record<string, unknown> }> {
  if (toolkit.authType === "none") return { row: null };
  if (input.connectedAccountId) {
    const row = await store.getAccount(input.connectedAccountId);
    if (!row || row.workspaceId !== input.workspaceId || row.toolkitSlug !== toolkit.slug) {
      return { http: 404, body: { error: "Connected account not found." } };
    }
    return { row };
  }
  const matches = (await store.listAccounts(input.workspaceId)).filter((item) => item.toolkitSlug === toolkit.slug && item.status === "active");
  if (matches.length === 1) return { row: await store.getAccount(matches[0].id) };
  if (matches.length === 0) return { http: 400, body: { error: `Connect ${toolkit.displayName} first.` } };
  return { http: 400, body: { error: "Pass connectedAccountId. More than one account is connected." } };
}

async function refreshIfNeeded(store: Store, toolkit: Toolkit, accountId: string, credentials: Record<string, unknown>) {
  if (!toolkit.oauth || typeof credentials.refresh_token !== "string" || typeof credentials.expires_at !== "string") return credentials;
  const expires = Date.parse(credentials.expires_at);
  if (!Number.isFinite(expires) || expires > Date.now() + 60_000) return credentials;
  return singleFlight(accountId, async () => {
    const next = await refreshAccessToken(toolkit.oauth!, credentials.refresh_token as string);
    const merged = {
      ...credentials,
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      expires_at: next.expires_at,
    };
    await store.updateAccountCredentials(accountId, await store.encrypt(merged), next.expires_at);
    return merged;
  });
}
