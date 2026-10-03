import { ZodError } from "zod";
import { redact, secretStrings, type Toolkit } from "@loopai/core";
import { executeToolkit, refreshAccessToken, type NotePort } from "@loopai/toolkits";
import { manuscriptPdf } from "./export-file";
import { singleFlight } from "./single-flight";
import type { Store } from "./store";

export type ExecuteInput = {
  workspaceId: string;
  toolkit: string;
  action: string;
  args: unknown;
  connectedAccountId?: string | null;
  idempotencyKey?: string | null;
  /** A write-scoped agent key, or a person who already pressed Confirm. */
  confirmed?: boolean;
  conversationId?: string | null;
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
    credentials = (await deps.store.decrypt(account.row.workspaceId, account.row.encryptedCredentials)) as Record<string, unknown>;
    credentials = await refreshIfNeeded(deps.store, toolkit, account.row.id, account.row.workspaceId, credentials);
  }
  const blocked = await attachExtras(deps, toolkit, input, credentials);
  if (blocked) return blocked;
  const action = toolkit.actions.find((item) => item.slug === input.action);
  if (action?.confirm && !input.confirmed) {
    const saved = await deps.store.insertApproval({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId ?? null,
      toolkitSlug: toolkit.slug,
      action: input.action,
      connectedAccountId: account.row?.id ?? input.connectedAccountId ?? null,
      argsEncrypted: await deps.store.encrypt(input.workspaceId, input.args ?? {}),
      summary: `${toolkit.displayName} ${input.action}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    return { http: 202, body: { status: "pending", approvalId: saved.id, summary: saved.summary } };
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

async function attachExtras(
  deps: Deps,
  toolkit: Toolkit,
  input: ExecuteInput,
  credentials: Record<string, unknown>,
): Promise<{ http: number; body: Record<string, unknown> } | null> {
  if (toolkit.slug === "notes" || toolkit.slug === "manuscript") {
    credentials.notePort = notePortFor(deps.store, input.workspaceId, toolkit.slug === "manuscript" ? "chapter" : "note");
  }
  if (toolkit.slug === "jobs" && input.action === "save_application") {
    credentials.notePort = notePortFor(deps.store, input.workspaceId, "application");
  }
  if (toolkit.slug === "profile" && input.action === "send_intro") {
    const picked = await pickAccount(deps, input, "gmail", hint(input.args, "gmailAccount"));
    if ("error" in picked) return picked.error;
    if (!picked.row) return { http: 400, body: { error: "Connect Gmail before sending an intro email." } };
    const gmail = deps.toolkits.find((item) => item.slug === "gmail");
    if (!gmail) return { http: 400, body: { error: "Connect Gmail before sending an intro email." } };
    let gmailCredentials = (await deps.store.decrypt(picked.row.workspaceId, picked.row.encryptedCredentials)) as Record<string, unknown>;
    gmailCredentials = await refreshIfNeeded(deps.store, gmail, picked.row.id, picked.row.workspaceId, gmailCredentials);
    if (typeof gmailCredentials.access_token !== "string") return { http: 400, body: { error: "Reconnect Gmail." } };
    credentials.gmailAccessToken = gmailCredentials.access_token;
  }
  if ((toolkit.slug === "review" && input.action === "analyze") || (toolkit.slug === "jobs" && input.action === "search")) {
    const profile = await pickAccount(deps, input, "profile", hint(input.args, "profileAccount"));
    if ("error" in profile) return profile.error;
    if (profile.row) {
      const saved = (await deps.store.decrypt(profile.row.workspaceId, profile.row.encryptedCredentials)) as Record<string, unknown>;
      credentials.profileName = saved.fullName;
      credentials.profileAbout = saved.about;
      credentials.profileEmail = saved.email;
      credentials.profileHeadline = saved.headline;
      credentials.profileSkills = saved.skills;
      credentials.profileExperience = saved.experience;
      credentials.profileResume = saved.resumeText;
    }
  }
  if (toolkit.slug === "review" && input.action === "analyze") {
    const github = await pickAccount(deps, input, "github", hint(input.args, "githubAccount"));
    if ("error" in github) return github.error;
    if (github.row) {
      const githubToolkit = deps.toolkits.find((item) => item.slug === "github");
      try {
        let githubCredentials = (await deps.store.decrypt(github.row.workspaceId, github.row.encryptedCredentials)) as Record<string, unknown>;
        if (githubToolkit) githubCredentials = await refreshIfNeeded(deps.store, githubToolkit, github.row.id, github.row.workspaceId, githubCredentials);
        if (typeof githubCredentials.access_token === "string") credentials.githubAccessToken = githubCredentials.access_token;
      } catch {
        // A dead GitHub token leaves the typed login as the fallback.
      }
    }
    const linkedin = await pickAccount(deps, input, "linkedin", hint(input.args, "linkedinAccount"));
    if ("error" in linkedin) return linkedin.error;
    const linkedinToolkit = deps.toolkits.find((item) => item.slug === "linkedin");
    if (linkedin.row && linkedinToolkit) {
      try {
        let linkedCredentials = (await deps.store.decrypt(linkedin.row.workspaceId, linkedin.row.encryptedCredentials)) as Record<string, unknown>;
        linkedCredentials = await refreshIfNeeded(deps.store, linkedinToolkit, linkedin.row.id, linkedin.row.workspaceId, linkedCredentials);
        if (typeof linkedCredentials.access_token === "string") credentials.linkedinAccessToken = linkedCredentials.access_token;
      } catch {
        // A dead LinkedIn token leaves that section missing. GitHub and the site still return.
      }
    }
  }
  if (toolkit.slug === "canva" && input.action === "import_manuscript") {
    const chapters = await deps.store.listNotes(input.workspaceId, "chapter");
    if (chapters.length === 0) return { http: 400, body: { error: "Add a chapter before sending the book to Canva." } };
    const pdf = await manuscriptPdf(chapters.slice(0, 40));
    credentials.manuscriptPdfBase64 = Buffer.from(pdf).toString("base64");
  }
  return null;
}

function notePortFor(store: Store, workspaceId: string, kind: "note" | "chapter" | "application"): NotePort {
  return {
    async save(input) {
      const saved = await store.insertNote({ workspaceId, kind: input.kind, title: input.title, body: input.body });
      return { id: saved.id, title: saved.title, body: saved.body };
    },
    search(_kind, query) {
      return store.searchNotes(workspaceId, kind, query);
    },
    list() {
      return store.listNotes(workspaceId, kind);
    },
    read(id) {
      return store.getNote(workspaceId, id);
    },
    async append(id, text) {
      const current = await store.getNote(workspaceId, id);
      if (!current || current.kind !== "chapter") return null;
      return store.appendNote(workspaceId, id, text);
    },
  };
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

function hint(args: unknown, key: string): string | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function pickAccount(
  deps: Deps,
  input: ExecuteInput,
  slug: string,
  preferred: string | null,
): Promise<{ row: Awaited<ReturnType<Store["getAccount"]>> } | { error: { http: number; body: Record<string, unknown> } }> {
  const matches = (await deps.store.listAccounts(input.workspaceId)).filter((item) => item.toolkitSlug === slug && item.status === "active");
  if (preferred) {
    const needle = preferred.replace(/-/g, "").toLowerCase();
    const found = matches.find((item) => item.id === preferred || item.id.replace(/-/g, "").toLowerCase().startsWith(needle) || item.externalLabel?.toLowerCase() === preferred.toLowerCase());
    if (!found) return { error: { http: 400, body: { error: `No ${slug} account matches ${preferred}.`, accounts: matches.map(labelOf) } } };
    return { row: await deps.store.getAccount(found.id) };
  }
  if (matches.length === 1) return { row: await deps.store.getAccount(matches[0].id) };
  if (matches.length === 0) return { row: null };
  return { error: { http: 400, body: { error: `More than one ${slug} account is connected.`, accounts: matches.map(labelOf) } } };
}

function labelOf(account: { id: string; externalLabel: string | null }): { id: string; label: string | null } {
  return { id: account.id, label: account.externalLabel };
}

async function refreshIfNeeded(store: Store, toolkit: Toolkit, accountId: string, workspaceId: string, credentials: Record<string, unknown>) {
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
    await store.updateAccountCredentials(accountId, await store.encrypt(workspaceId, merged), next.expires_at);
    return merged;
  });
}
