import { randomUUID } from "node:crypto";
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
};

type Memory = {
  workspace: { id: string; name: string; dek: Buffer } | null;
  accounts: AccountRecord[];
  states: OAuthStateRecord[];
  executions: (ExecutionRecord & { workspaceId: string; idempotencyKey: string | null })[];
  llms: (LlmRecord & { workspaceId: string })[];
  keys: { id: string; workspaceId: string; name: string; keyHash: string; keyPrefix: string; createdAt: string }[];
  conversations: { id: string; workspaceId: string; title: string; createdAt: string }[];
  messages: { conversationId: string; role: string; content: string }[];
};

export function createMemoryStore(_masterKey: Buffer): Store {
  const db: Memory = {
    workspace: null,
    accounts: [],
    states: [],
    executions: [],
    llms: [],
    keys: [],
    conversations: [],
    messages: [],
  };

  const store: Store = {
    async ensureWorkspace() {
      if (!db.workspace) {
        db.workspace = { id: randomUUID(), name: "My workspace", dek: newDataKey() };
      }
      return { id: db.workspace.id, name: db.workspace.name };
    },
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
      const row = { id: randomUUID(), status: input.status, resultRedacted: input.resultRedacted, errorCode: input.errorCode, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey };
      db.executions.push(row);
      return row;
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
  };

  return store;
}

function publish(account: AccountRecord): PublicAccount {
  const { encryptedCredentials: _hidden, ...rest } = account;
  return rest;
}
