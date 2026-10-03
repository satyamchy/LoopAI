import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AccountScope } from "@loopai/core";
import { decryptJson, encryptJson, newDataKey } from "@loopai/vault";

/** Persistence used by the API. Memory is for tests and for UI work before Supabase is configured. */
export type MemberRole = "owner" | "member";

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

export type AccountRecord = PublicAccount & { encryptedCredentials: string; createdBy: string | null };

export type ExecutionRecord = {
  id: string;
  status: string;
  resultRedacted: unknown;
  errorCode: string | null;
};

export type ExecutionDetail = ExecutionRecord & { toolkitSlug: string; action: string };

export type ExecutionListItem = ExecutionDetail & { createdAt: string };

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
  workspaceId: string | null;
  toolkitSlug: string;
  codeVerifierEncrypted: string;
  scope: AccountScope;
  expiresAt: string;
};

export type ApprovalRecord = {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  toolkitSlug: string;
  action: string;
  connectedAccountId: string | null;
  argsEncrypted: string;
  summary: string;
  status: string;
  expiresAt: string;
};

export type AgentKeyPublic = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  expiresAt: string | null;
  clientName: string | null;
  clientVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Membership = { workspaceId: string; name: string; role: MemberRole };

export type DeleteActor = { userId: string | null; role: MemberRole | "agent" };

export type Store = {
  ensureWorkspace(): Promise<{ id: string; name: string }>;
  repairSharedVaults(): Promise<number>;
  ping(): Promise<void>;
  encrypt(workspaceId: string | null, value: unknown): Promise<string>;
  decrypt(workspaceId: string | null, payload: string): Promise<unknown>;
  listAccounts(workspaceId: string): Promise<PublicAccount[]>;
  getAccount(id: string): Promise<AccountRecord | null>;
  insertAccount(input: Omit<AccountRecord, "id" | "status" | "createdAt" | "createdBy"> & { createdBy?: string | null }): Promise<PublicAccount>;
  updateAccountCredentials(id: string, encryptedCredentials: string, expiresAt: string | null, label?: string | null): Promise<void>;
  deleteAccount(workspaceId: string, id: string, actor?: DeleteActor): Promise<"ok" | "missing" | "forbidden">;
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
  listExecutions(workspaceId: string): Promise<ExecutionListItem[]>;
  insertApproval(input: Omit<ApprovalRecord, "id" | "status">): Promise<ApprovalRecord>;
  getApproval(workspaceId: string, id: string): Promise<ApprovalRecord | null>;
  setApprovalStatus(id: string, status: string): Promise<void>;
  insertNote(input: { workspaceId: string; kind: string; title: string; body: string }): Promise<NoteRecord>;
  searchNotes(workspaceId: string, kind: string, query: string): Promise<NoteRecord[]>;
  listNotes(workspaceId: string, kind: string): Promise<NoteRecord[]>;
  getNote(workspaceId: string, id: string): Promise<NoteRecord | null>;
  appendNote(workspaceId: string, id: string, text: string): Promise<NoteRecord | null>;
  listLlms(workspaceId: string): Promise<LlmPublic[]>;
  getLlm(id: string): Promise<LlmRecord | null>;
  insertLlm(input: { workspaceId: string; provider: string; model: string; baseUrl: string | null; encryptedApiKey: string }): Promise<LlmPublic>;
  insertAgentKey(input: { workspaceId: string; name: string; keyHash: string; keyPrefix: string; scopes: string; expiresAt: string | null }): Promise<{ id: string }>;
  listAgentKeys(workspaceId: string): Promise<AgentKeyPublic[]>;
  findAgentKey(keyHash: string): Promise<{ workspaceId: string; scopes: string[] } | null>;
  touchAgentKey(keyHash: string, client: { name: string; version: string | null } | null): Promise<void>;
  createConversation(workspaceId: string, title: string): Promise<{ id: string }>;
  listConversations(workspaceId: string): Promise<{ id: string; title: string; createdAt: string }[]>;
  getConversation(id: string): Promise<{ id: string; workspaceId: string } | null>;
  listMessages(conversationId: string): Promise<{ role: string; content: string }[]>;
  insertMessage(conversationId: string, role: string, content: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  createUser(input: { username: string; passwordHash: string | null; displayName: string; email: string | null; googleSub: string | null; emailVerified?: boolean }): Promise<SessionUser>;
  findUserByUsername(username: string): Promise<(SessionUser & { passwordHash: string | null }) | null>;
  findUserByGoogleSub(googleSub: string): Promise<SessionUser | null>;
  listMemberships(userId: string): Promise<Membership[]>;
  inviteMember(workspaceId: string, username: string): Promise<{ ok: true; username: string; role: MemberRole } | { ok: false; error: string }>;
  setSessionWorkspace(tokenHash: string, workspaceId: string): Promise<boolean>;
  createPasswordReset(userId: string): Promise<string>;
  takePasswordReset(tokenHash: string): Promise<string | null>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  createEmailVerification(userId: string): Promise<string>;
  takeEmailVerification(tokenHash: string): Promise<boolean>;
  createSession(userId: string): Promise<{ rawToken: string }>;
  findSession(tokenHash: string): Promise<SessionUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
};

export type SessionUser = {
  userId: string;
  workspaceId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  email: string | null;
  emailVerified: boolean;
};

type MemoryUser = {
  id: string;
  username: string;
  passwordHash: string | null;
  displayName: string;
  email: string | null;
  googleSub: string | null;
  emailVerified: boolean;
  createdAt: string;
};

type Memory = {
  workspaces: { id: string; name: string; dek: Buffer; createdAt: string }[];
  members: { workspaceId: string; userId: string; role: MemberRole }[];
  accounts: AccountRecord[];
  states: OAuthStateRecord[];
  executions: (ExecutionListItem & { workspaceId: string; idempotencyKey: string | null })[];
  approvals: ApprovalRecord[];
  notes: (NoteRecord & { workspaceId: string })[];
  llms: (LlmRecord & { workspaceId: string })[];
  keys: (AgentKeyPublic & { workspaceId: string; keyHash: string; revokedAt: string | null })[];
  conversations: { id: string; workspaceId: string; title: string; createdAt: string }[];
  messages: { conversationId: string; role: string; content: string }[];
  users: MemoryUser[];
  sessions: { tokenHash: string; userId: string; workspaceId: string; expiresAt: string }[];
  resets: { tokenHash: string; userId: string; expiresAt: string }[];
  verifies: { tokenHash: string; userId: string; expiresAt: string }[];
};

export function createMemoryStore(masterKey: Buffer): Store {
  const db: Memory = {
    workspaces: [],
    members: [],
    accounts: [],
    states: [],
    executions: [],
    approvals: [],
    notes: [],
    llms: [],
    keys: [],
    conversations: [],
    messages: [],
    users: [],
    sessions: [],
    resets: [],
    verifies: [],
  };

  function createWorkspace(name: string) {
    const row = { id: randomUUID(), name, dek: newDataKey(), createdAt: new Date().toISOString() };
    db.workspaces.push(row);
    return row;
  }

  function ownedWorkspace(userId: string) {
    return db.members.find((item) => item.userId === userId && item.role === "owner") ?? db.members.find((item) => item.userId === userId) ?? null;
  }

  const store: Store = {
    async ensureWorkspace() {
      return db.workspaces[0] ?? createWorkspace("My workspace");
    },
    async repairSharedVaults() {
      let moved = 0;
      const ids = [...new Set(db.members.map((item) => item.workspaceId))];
      for (const workspaceId of ids) {
        const rows = db.members
          .filter((item) => item.workspaceId === workspaceId)
          .map((item) => ({ item, createdAt: db.users.find((user) => user.id === item.userId)?.createdAt ?? "" }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const extra of rows.slice(1)) {
          const created = createWorkspace("My workspace");
          db.members = db.members.filter((item) => !(item.workspaceId === workspaceId && item.userId === extra.item.userId));
          db.members.push({ workspaceId: created.id, userId: extra.item.userId, role: "owner" });
          for (const session of db.sessions) {
            if (session.userId === extra.item.userId) session.workspaceId = created.id;
          }
          moved += 1;
        }
      }
      return moved;
    },
    async ping() {},
    async encrypt(workspaceId, value) {
      const key = workspaceId ? (db.workspaces.find((item) => item.id === workspaceId)?.dek ?? null) : masterKey;
      if (!key) throw new Error("Workspace is missing its encryption key.");
      return encryptJson(value, key);
    },
    async decrypt(workspaceId, payload) {
      const key = workspaceId ? (db.workspaces.find((item) => item.id === workspaceId)?.dek ?? null) : masterKey;
      if (!key) throw new Error("Workspace is missing its encryption key.");
      return decryptJson(payload, key);
    },
    async listAccounts(workspaceId) {
      return db.accounts.filter((account) => account.workspaceId === workspaceId).map(publish);
    },
    async getAccount(id) {
      return db.accounts.find((account) => account.id === id) ?? null;
    },
    async insertAccount(input) {
      const account: AccountRecord = {
        ...input,
        createdBy: input.createdBy ?? null,
        id: randomUUID(),
        status: "active",
        createdAt: new Date().toISOString(),
      };
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
    async deleteAccount(workspaceId, id, actor) {
      const account = db.accounts.find((item) => item.id === id && item.workspaceId === workspaceId);
      if (!account) return "missing";
      if (actor?.role === "member" && account.createdBy && account.createdBy !== actor.userId) return "forbidden";
      db.accounts = db.accounts.filter((item) => item !== account);
      return "ok";
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
        createdAt: new Date().toISOString(),
      };
      db.executions.push(row);
      return row;
    },
    async getExecution(workspaceId, id) {
      return db.executions.find((item) => item.workspaceId === workspaceId && item.id === id) ?? null;
    },
    async listExecutions(workspaceId) {
      return db.executions.filter((item) => item.workspaceId === workspaceId).slice(-50).reverse();
    },
    async insertApproval(input) {
      const row: ApprovalRecord = { ...input, id: randomUUID(), status: "pending" };
      db.approvals.push(row);
      return row;
    },
    async getApproval(workspaceId, id) {
      return db.approvals.find((item) => item.workspaceId === workspaceId && item.id === id) ?? null;
    },
    async setApprovalStatus(id, status) {
      const row = db.approvals.find((item) => item.id === id);
      if (row) row.status = status;
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
      const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), revokedAt: null, clientName: null, clientVersion: null, lastSeenAt: null };
      db.keys.push(row);
      return { id: row.id };
    },
    async listAgentKeys(workspaceId) {
      return db.keys
        .filter((item) => item.workspaceId === workspaceId && !item.revokedAt)
        .map(({ id, name, keyPrefix, scopes, expiresAt, clientName, clientVersion, lastSeenAt, createdAt }) => ({ id, name, keyPrefix, scopes, expiresAt, clientName, clientVersion, lastSeenAt, createdAt }));
    },
    async findAgentKey(keyHash) {
      const found = db.keys.find((item) => item.keyHash === keyHash && !item.revokedAt);
      if (!found) return null;
      if (found.expiresAt && Date.parse(found.expiresAt) <= Date.now()) return null;
      return { workspaceId: found.workspaceId, scopes: found.scopes.split(",").filter(Boolean) };
    },
    async touchAgentKey(keyHash, client) {
      const found = db.keys.find((item) => item.keyHash === keyHash && !item.revokedAt);
      if (!found) return;
      found.lastSeenAt = new Date().toISOString();
      if (client) {
        found.clientName = client.name;
        found.clientVersion = client.version;
      }
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
      return db.messages.filter((item) => item.conversationId === conversationId).slice(-40);
    },
    async insertMessage(conversationId, role, content) {
      db.messages.push({ conversationId, role, content });
    },
    async deleteConversation(id) {
      db.messages = db.messages.filter((item) => item.conversationId !== id);
      db.conversations = db.conversations.filter((item) => item.id !== id);
    },
    async createUser(input) {
      const workspace = createWorkspace(`${input.displayName}'s workspace`);
      const row: MemoryUser = {
        id: randomUUID(),
        username: input.username,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        email: input.email,
        googleSub: input.googleSub,
        emailVerified: Boolean(input.emailVerified),
        createdAt: new Date().toISOString(),
      };
      db.users.push(row);
      db.members.push({ workspaceId: workspace.id, userId: row.id, role: "owner" });
      return publishUser(row, workspace.id, "owner");
    },
    async findUserByUsername(username) {
      const row = db.users.find((item) => item.username === username);
      const member = row ? ownedWorkspace(row.id) : null;
      return row && member ? { ...publishUser(row, member.workspaceId, member.role), passwordHash: row.passwordHash } : null;
    },
    async findUserByGoogleSub(googleSub) {
      const row = db.users.find((item) => item.googleSub === googleSub);
      const member = row ? ownedWorkspace(row.id) : null;
      return row && member ? publishUser(row, member.workspaceId, member.role) : null;
    },
    async listMemberships(userId) {
      return db.members
        .filter((item) => item.userId === userId)
        .map((item) => ({
          workspaceId: item.workspaceId,
          name: db.workspaces.find((workspace) => workspace.id === item.workspaceId)?.name ?? "Workspace",
          role: item.role,
        }));
    },
    async inviteMember(workspaceId, username) {
      const user = db.users.find((item) => item.username === username);
      if (!user) return { ok: false, error: "No account uses that username." };
      if (db.members.some((item) => item.workspaceId === workspaceId && item.userId === user.id)) {
        return { ok: false, error: "That person is already in this workspace." };
      }
      db.members.push({ workspaceId, userId: user.id, role: "member" });
      return { ok: true, username: user.username, role: "member" };
    },
    async setSessionWorkspace(tokenHash, workspaceId) {
      const session = db.sessions.find((item) => item.tokenHash === tokenHash);
      if (!session) return false;
      const member = db.members.find((item) => item.userId === session.userId && item.workspaceId === workspaceId);
      if (!member) return false;
      session.workspaceId = workspaceId;
      return true;
    },
    async createPasswordReset(userId) {
      const raw = randomBytes(24).toString("base64url");
      db.resets.push({ tokenHash: hashToken(raw), userId, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
      return raw;
    },
    async takePasswordReset(tokenHash) {
      const index = db.resets.findIndex((item) => item.tokenHash === tokenHash);
      if (index < 0) return null;
      const [row] = db.resets.splice(index, 1);
      return Date.parse(row.expiresAt) > Date.now() ? row.userId : null;
    },
    async setPassword(userId, passwordHash) {
      const user = db.users.find((item) => item.id === userId);
      if (user) user.passwordHash = passwordHash;
    },
    async createEmailVerification(userId) {
      const raw = randomBytes(24).toString("base64url");
      db.verifies.push({ tokenHash: hashToken(raw), userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      return raw;
    },
    async takeEmailVerification(tokenHash) {
      const index = db.verifies.findIndex((item) => item.tokenHash === tokenHash);
      if (index < 0) return false;
      const [row] = db.verifies.splice(index, 1);
      if (Date.parse(row.expiresAt) <= Date.now()) return false;
      const user = db.users.find((item) => item.id === row.userId);
      if (!user) return false;
      user.emailVerified = true;
      return true;
    },
    async createSession(userId) {
      const member = ownedWorkspace(userId);
      if (!member) throw new Error("User has no workspace.");
      const rawToken = randomUUID() + randomUUID();
      db.sessions.push({
        tokenHash: hashToken(rawToken),
        userId,
        workspaceId: member.workspaceId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });
      return { rawToken };
    },
    async findSession(tokenHash) {
      const session = db.sessions.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) > Date.now());
      const row = session ? db.users.find((item) => item.id === session.userId) : undefined;
      const member = session ? db.members.find((item) => item.userId === session.userId && item.workspaceId === session.workspaceId) : undefined;
      return row && member ? publishUser(row, member.workspaceId, member.role) : null;
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
  const { encryptedCredentials: _hidden, createdBy: _owner, ...rest } = account;
  return rest;
}

function publishUser(row: MemoryUser, workspaceId: string, role: MemberRole): SessionUser {
  return {
    userId: row.id,
    workspaceId,
    username: row.username,
    displayName: row.displayName,
    role,
    email: row.email,
    emailVerified: row.emailVerified,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
