import { createHash, randomUUID } from "node:crypto";
import type { AccountScope } from "@loopai/core";
import { decryptJson, encryptJson, newDataKey } from "@loopai/vault";

/** Persistence used by the API. Memory is for tests and for UI work before Supabase is configured. */
export type PublicAccount = {
  id: string;
  workspaceId: string;
  toolkitSlug: string;
  scope: AccountScope;
  status: string;
  externalLabel: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type AccountRecord = PublicAccount & { encryptedCredentials: string };

export type ExecutionRecord = {
  id: string;
  status: string;
  resultRedacted: unknown;
  errorCode: string | null;
};

export type ExecutionDetail = ExecutionRecord & { toolkitSlug: string; action: string };

export type NoteRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
};

export type LlmPublic = { id: string; provider: string; model: string; baseUrl: string | null };
export type LlmRecord = LlmPublic & { encryptedApiKey: string };

export type OAuthStateRecord = {
  state: string;
  workspaceId: string;
  toolkitSlug: string;
  codeVerifierEncrypted: string;
  scope: AccountScope;
  expiresAt: string;
};

export type Store = {
  ensureWorkspace(): Promise<{ id: string; name: string }>;
  ping(): Promise<void>;
  encrypt(value: unknown): Promise<string>;
  decrypt(payload: string): Promise<unknown>;
  listAccounts(workspaceId: string): Promise<PublicAccount[]>;
  getAccount(id: string): Promise<AccountRecord | null>;
  insertAccount(input: Omit<AccountRecord, "id" | "status" | "createdAt">): Promise<PublicAccount>;
  updateAccountCredentials(id: string, encryptedCredentials: string, expiresAt: string | null, label?: string | null): Promise<void>;
  deleteAccount(workspaceId: string, id: string): Promise<boolean>;
  insertOAuthState(input: OAuthStateRecord): Promise<void>;
  takeOAuthState(state: string): Promise<OAuthStateRecord | null>;
  findExecution(workspaceId: string, idempotencyKey: string): Promise<ExecutionRecord | null>;
  insertExecution(input: {
    workspaceId: string;
    connectedAccountId: string | null;
    toolkitSlug: string;
    action: string;
    idempotencyKey: string | null;
    argsRedacted: unknown;
    resultRedacted: unknown;
    status: string;
    latencyMs: number;
    errorCode: string | null;
  }): Promise<ExecutionRecord>;
  getExecution(workspaceId: string, id: string): Promise<ExecutionDetail | null>;
  insertNote(input: { workspaceId: string; kind: string; title: string; body: string }): Promise<NoteRecord>;
  searchNotes(workspaceId: string, kind: string, query: string): Promise<NoteRecord[]>;
  listNotes(workspaceId: string, kind: string): Promise<NoteRecord[]>;
  getNote(workspaceId: string, id: string): Promise<NoteRecord | null>;
  appendNote(workspaceId: string, id: string, text: string): Promise<NoteRecord | null>;
  listLlms(workspaceId: string): Promise<LlmPublic[]>;
  getLlm(id: string): Promise<LlmRecord | null>;
  insertLlm(input: { workspaceId: string; provider: string; model: string; baseUrl: string | null; encryptedApiKey: string }): Promise<LlmPublic>;
  insertAgentKey(input: { workspaceId: string; name: string; keyHash: string; keyPrefix: string }): Promise<{ id: string }>;
  listAgentKeys(workspaceId: string): Promise<{ id: string; name: string; keyPrefix: string; createdAt: string }[]>;
  findAgentKey(keyHash: string): Promise<{ workspaceId: string } | null>;
  createConversation(workspaceId: string, title: string): Promise<{ id: string }>;
  listConversations(workspaceId: string): Promise<{ id: string; title: string; createdAt: string }[]>;
  getConversation(id: string): Promise<{ id: string; workspaceId: string } | null>;
  listMessages(conversationId: string): Promise<{ role: string; content: string }[]>;
  insertMessage(conversationId: string, role: string, content: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  createUser(input: { username: string; passwordHash: string | null; displayName: string; email: string | null; googleSub: string | null }): Promise<SessionUser>;
  findUserByUsername(username: string): Promise<(SessionUser & { passwordHash: string | null }) | null>;
  findUserByGoogleSub(googleSub: string): Promise<SessionUser | null>;
  createSession(userId: string): Promise<{ rawToken: string }>;
  findSession(tokenHash: string): Promise<SessionUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
};

export type SessionUser = {
  userId: string;
  workspaceId: string;
  username: string;
  displayName: string;
};

type Memory = {
  workspace: { id: string; name: string; dek: Buffer } | null;
  accounts: AccountRecord[];
  states: OAuthStateRecord[];
  executions: (ExecutionDetail & { workspaceId: string; idempotencyKey: string | null })[];
  notes: (NoteRecord & { workspaceId: string })[];
  llms: (LlmRecord & { workspaceId: string })[];
  keys: { id: string; workspaceId: string; name: string; keyHash: string; keyPrefix: string; createdAt: string }[];
  conversations: { id: string; workspaceId: string; title: string; createdAt: string }[];
  messages: { conversationId: string; role: string; content: string }[];
  users: { id: string; workspaceId: string; username: string; passwordHash: string | null; displayName: string; email: string | null; googleSub: string | null }[];
  sessions: { tokenHash: string; userId: string; expiresAt: string }[];
};

export function createMemoryStore(_masterKey: Buffer): Store {
  const db: Memory = {
    workspace: null,
    accounts: [],
    states: [],
    executions: [],
    notes: [],
    llms: [],
    keys: [],
    conversations: [],
    messages: [],
    users: [],
    sessions: [],
  };

  const store: Store = {
    async ensureWorkspace() {
      if (!db.workspace) {
        db.workspace = { id: randomUUID(), name: "My workspace", dek: newDataKey() };
      }
      return { id: db.workspace.id, name: db.workspace.name };
    },
    async ping() {},
    async encrypt(value) {
      await store.ensureWorkspace();
      return encryptJson(value, db.workspace!.dek);
    },
    async decrypt(payload) {
      await store.ensureWorkspace();
      return decryptJson(payload, db.workspace!.dek);
    },
    async listAccounts(workspaceId) {
      return db.accounts.filter((account) => account.workspaceId === workspaceId).map(publish);
    },
    async getAccount(id) {
      return db.accounts.find((account) => account.id === id) ?? null;
    },
    async insertAccount(input) {
      const account: AccountRecord = { ...input, id: randomUUID(), status: "active", createdAt: new Date().toISOString() };
      db.accounts.push(account);
      return publish(account);
    },
    async updateAccountCredentials(id, encryptedCredentials, expiresAt, label) {
      const account = db.accounts.find((item) => item.id === id);
      if (!account) return;
      account.encryptedCredentials = encryptedCredentials;
      account.expiresAt = expiresAt;
      if (label) account.externalLabel = label;
    },
    async deleteAccount(workspaceId, id) {
      const before = db.accounts.length;
      db.accounts = db.accounts.filter((account) => !(account.id === id && account.workspaceId === workspaceId));
      return db.accounts.length < before;
    },
    async insertOAuthState(input) {
      db.states.push(input);
    },
    async takeOAuthState(state) {
      const index = db.states.findIndex((item) => item.state === state);
      if (index < 0) return null;
      const [row] = db.states.splice(index, 1);
      return Date.parse(row.expiresAt) > Date.now() ? row : null;
    },
    async findExecution(workspaceId, idempotencyKey) {
      return db.executions.find((item) => item.workspaceId === workspaceId && item.idempotencyKey === idempotencyKey) ?? null;
    },
    async insertExecution(input) {
      const row = {
        id: randomUUID(),
        status: input.status,
        resultRedacted: input.resultRedacted,
        errorCode: input.errorCode,
        toolkitSlug: input.toolkitSlug,
        action: input.action,
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      };
      db.executions.push(row);
      return row;
    },
    async getExecution(workspaceId, id) {
      return db.executions.find((item) => item.workspaceId === workspaceId && item.id === id) ?? null;
    },
    async insertNote(input) {
      const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      db.notes.push(row);
      return publishNote(row);
    },
    async searchNotes(workspaceId, kind, query) {
      const needle = query.trim().toLowerCase();
      return db.notes
        .filter((item) => item.workspaceId === workspaceId && item.kind === kind)
        .filter((item) => `${item.title}\n${item.body}`.toLowerCase().includes(needle))
        .slice(-20)
        .reverse()
        .map(publishNote);
    },
    async listNotes(workspaceId, kind) {
      return db.notes
        .filter((item) => item.workspaceId === workspaceId && item.kind === kind)
        .slice(-100)
        .reverse()
        .map(publishNote);
    },
    async getNote(workspaceId, id) {
      const row = db.notes.find((item) => item.workspaceId === workspaceId && item.id === id);
      return row ? publishNote(row) : null;
    },
    async appendNote(workspaceId, id, text) {
      const row = db.notes.find((item) => item.workspaceId === workspaceId && item.id === id);
      if (!row) return null;
      row.body = `${row.body}\n\n${text}`;
      return publishNote(row);
    },
    async listLlms(workspaceId) {
      return db.llms.filter((item) => item.workspaceId === workspaceId).map(({ id, provider, model, baseUrl }) => ({ id, provider, model, baseUrl }));
    },
    async getLlm(id) {
      return db.llms.find((item) => item.id === id) ?? null;
    },
    async insertLlm(input) {
      const row = { ...input, id: randomUUID() };
      db.llms.push(row);
      return { id: row.id, provider: row.provider, model: row.model, baseUrl: row.baseUrl };
    },
    async insertAgentKey(input) {
      const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      db.keys.push(row);
      return { id: row.id };
    },
    async listAgentKeys(workspaceId) {
      return db.keys.filter((item) => item.workspaceId === workspaceId).map(({ id, name, keyPrefix, createdAt }) => ({ id, name, keyPrefix, createdAt }));
    },
    async findAgentKey(keyHash) {
      const found = db.keys.find((item) => item.keyHash === keyHash);
      return found ? { workspaceId: found.workspaceId } : null;
    },
    async createConversation(workspaceId, title) {
      const row = { id: randomUUID(), workspaceId, title, createdAt: new Date().toISOString() };
      db.conversations.push(row);
      return { id: row.id };
    },
    async listConversations(workspaceId) {
      return db.conversations
        .filter((item) => item.workspaceId === workspaceId)
        .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
        .reverse();
    },
    async getConversation(id) {
      return db.conversations.find((item) => item.id === id) ?? null;
    },
    async listMessages(conversationId) {
      return db.messages.filter((item) => item.conversationId === conversationId).slice(-20);
    },
    async insertMessage(conversationId, role, content) {
      db.messages.push({ conversationId, role, content });
    },
    async deleteConversation(id) {
      db.messages = db.messages.filter((item) => item.conversationId !== id);
      db.conversations = db.conversations.filter((item) => item.id !== id);
    },
    async createUser(input) {
      const workspace = await store.ensureWorkspace();
      const row = { id: randomUUID(), workspaceId: workspace.id, ...input };
      db.users.push(row);
      return publishUser(row);
    },
    async findUserByUsername(username) {
      const row = db.users.find((item) => item.username === username);
      return row ? { ...publishUser(row), passwordHash: row.passwordHash } : null;
    },
    async findUserByGoogleSub(googleSub) {
      const row = db.users.find((item) => item.googleSub === googleSub);
      return row ? publishUser(row) : null;
    },
    async createSession(userId) {
      const rawToken = randomUUID() + randomUUID();
      db.sessions.push({ tokenHash: hashToken(rawToken), userId, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() });
      return { rawToken };
    },
    async findSession(tokenHash) {
      const session = db.sessions.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) > Date.now());
      const row = session ? db.users.find((item) => item.id === session.userId) : undefined;
      return row ? publishUser(row) : null;
    },
    async deleteSession(tokenHash) {
      const index = db.sessions.findIndex((item) => item.tokenHash === tokenHash);
      if (index >= 0) db.sessions.splice(index, 1);
    },
  };

  return store;
}

function publishNote(row: NoteRecord & { workspaceId: string }): NoteRecord {
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, createdAt: row.createdAt };
}

function publish(account: AccountRecord): PublicAccount {
  const { encryptedCredentials: _hidden, ...rest } = account;
  return rest;
}

function publishUser(row: { id: string; workspaceId: string; username: string; displayName: string }): SessionUser {
  return { userId: row.id, workspaceId: row.workspaceId, username: row.username, displayName: row.displayName };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
