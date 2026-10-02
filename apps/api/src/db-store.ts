import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AccountScope } from "@loopai/core";
import { createDb, schema } from "@loopai/db";
import { decryptJson, encryptJson, newDataKey, unwrapKey, wrapKey } from "@loopai/vault";
import type { AccountRecord, ExecutionRecord, OAuthStateRecord, PublicAccount, Store } from "./store";

type Scope = AccountScope;

/**
 * Supabase-backed store. The data key is unwrapped once per process.
 * Credential plaintext exists only in the return value of decrypt.
 */
export function createSupabaseStore(databaseUrl: string, masterKey: Buffer): Store {
  const db = createDb(databaseUrl);
  let cached: { id: string; name: string; dek: Buffer } | null = null;

  const store: Store = {
    async ensureWorkspace() {
      if (cached) return { id: cached.id, name: cached.name };
      const existing = await db.select().from(schema.workspaces).limit(1);
      if (existing[0]) {
        const keys = await db.select().from(schema.workspaceKeys).where(eq(schema.workspaceKeys.workspaceId, existing[0].id));
        if (!keys[0]) throw new Error("Workspace is missing its encryption key.");
        cached = { id: existing[0].id, name: existing[0].name, dek: unwrapKey(keys[0].wrappedDek, masterKey) };
        return { id: cached.id, name: cached.name };
      }
      const id = randomUUID();
      const dek = newDataKey();
      await db.insert(schema.workspaces).values({ id, name: "My workspace" });
      await db.insert(schema.workspaceKeys).values({ workspaceId: id, wrappedDek: wrapKey(dek, masterKey) });
      cached = { id, name: "My workspace", dek };
      return { id, name: "My workspace" };
    },
    async ping() {
      await db.execute(sql`select 1`);
    },
    async encrypt(value) {
      await store.ensureWorkspace();
      return encryptJson(value, cached!.dek);
    },
    async decrypt(payload) {
      await store.ensureWorkspace();
      return decryptJson(payload, cached!.dek);
    },
    async listAccounts(workspaceId) {
      const rows = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.workspaceId, workspaceId));
      return rows.map(toPublic);
    },
    async getAccount(id) {
      const rows = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async insertAccount(input) {
      const rows = await db
        .insert(schema.connectedAccounts)
        .values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          toolkitSlug: input.toolkitSlug,
          scope: input.scope,
          status: "active",
          externalLabel: input.externalLabel,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          encryptedCredentials: input.encryptedCredentials,
        })
        .returning();
      return toPublic(rows[0]);
    },
    async updateAccountCredentials(id, encryptedCredentials, expiresAt, label) {
      await db
        .update(schema.connectedAccounts)
        .set({
          encryptedCredentials,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          updatedAt: new Date(),
          ...(label ? { externalLabel: label } : {}),
        })
        .where(eq(schema.connectedAccounts.id, id));
    },
    async deleteAccount(workspaceId, id) {
      const removed = await db
        .delete(schema.connectedAccounts)
        .where(and(eq(schema.connectedAccounts.id, id), eq(schema.connectedAccounts.workspaceId, workspaceId)))
        .returning({ id: schema.connectedAccounts.id });
      return removed.length > 0;
    },
    async insertOAuthState(input) {
      await db.insert(schema.oauthStates).values({ ...input, expiresAt: new Date(input.expiresAt) });
    },
    async takeOAuthState(state) {
      const removed = await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)).returning();
      const row = removed[0];
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return {
        state: row.state,
        workspaceId: row.workspaceId,
        toolkitSlug: row.toolkitSlug,
        codeVerifierEncrypted: row.codeVerifierEncrypted,
        scope: row.scope as Scope,
        expiresAt: row.expiresAt.toISOString(),
      };
    },
    async findExecution(workspaceId, idempotencyKey) {
      const rows = await db
        .select()
        .from(schema.toolExecutions)
        .where(and(eq(schema.toolExecutions.workspaceId, workspaceId), eq(schema.toolExecutions.idempotencyKey, idempotencyKey)))
        .limit(1);
      return rows[0] ? toExecution(rows[0]) : null;
    },
    async insertExecution(input) {
      const id = randomUUID();
      await db.insert(schema.toolExecutions).values({
        id,
        workspaceId: input.workspaceId,
        connectedAccountId: input.connectedAccountId,
        toolkitSlug: input.toolkitSlug,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
        argsRedacted: input.argsRedacted,
        resultRedacted: input.resultRedacted,
        status: input.status,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
      });
      return { id, status: input.status, resultRedacted: input.resultRedacted, errorCode: input.errorCode };
    },
    async listLlms(workspaceId) {
      const rows = await db.select().from(schema.llmConnections).where(eq(schema.llmConnections.workspaceId, workspaceId));
      return rows.map((row) => ({ id: row.id, provider: row.provider, model: row.model, baseUrl: row.baseUrl }));
    },
    async getLlm(id) {
      const rows = await db.select().from(schema.llmConnections).where(eq(schema.llmConnections.id, id)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, provider: row.provider, model: row.model, baseUrl: row.baseUrl, encryptedApiKey: row.encryptedApiKey };
    },
    async insertLlm(input) {
      const id = randomUUID();
      await db.insert(schema.llmConnections).values({ id, ...input });
      return { id, provider: input.provider, model: input.model, baseUrl: input.baseUrl };
    },
    async insertAgentKey(input) {
      const id = randomUUID();
      await db.insert(schema.agentKeys).values({ id, ...input });
      return { id };
    },
    async listAgentKeys(workspaceId) {
      const rows = await db.select().from(schema.agentKeys).where(eq(schema.agentKeys.workspaceId, workspaceId));
      return rows.map((row) => ({ id: row.id, name: row.name, keyPrefix: row.keyPrefix, createdAt: row.createdAt.toISOString() }));
    },
    async findAgentKey(keyHash) {
      const rows = await db
        .select()
        .from(schema.agentKeys)
        .where(and(eq(schema.agentKeys.keyHash, keyHash), isNull(schema.agentKeys.revokedAt)))
        .limit(1);
      return rows[0] ? { workspaceId: rows[0].workspaceId } : null;
    },
    async createConversation(workspaceId, title) {
      const id = randomUUID();
      await db.insert(schema.conversations).values({ id, workspaceId, title });
      return { id };
    },
    async listConversations(workspaceId) {
      const rows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId))
        .orderBy(desc(schema.conversations.createdAt));
      return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.createdAt.toISOString() }));
    },
    async getConversation(id) {
      const rows = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
      return rows[0] ? { id: rows[0].id, workspaceId: rows[0].workspaceId } : null;
    },
    async listMessages(conversationId) {
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(desc(schema.messages.createdAt))
        .limit(20);
      return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
    },
    async insertMessage(conversationId, role, content) {
      await db.insert(schema.messages).values({ id: randomUUID(), conversationId, role, content });
    },
    async deleteConversation(id) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
    },
    async createUser(input) {
      const workspace = await store.ensureWorkspace();
      const id = randomUUID();
      await db.insert(schema.users).values({ id, ...input });
      await db.insert(schema.workspaceMembers).values({ workspaceId: workspace.id, userId: id, role: "owner" });
      return { userId: id, workspaceId: workspace.id, username: input.username, displayName: input.displayName };
    },
    async findUserByUsername(username) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
      const row = rows[0];
      if (!row?.username || !row.displayName) return null;
      const member = await membership(row.id);
      if (!member) return null;
      return { userId: row.id, workspaceId: member, username: row.username, displayName: row.displayName, passwordHash: row.passwordHash };
    },
    async findUserByGoogleSub(googleSub) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.googleSub, googleSub)).limit(1);
      const row = rows[0];
      if (!row?.username || !row.displayName) return null;
      const member = await membership(row.id);
      if (!member) return null;
      return { userId: row.id, workspaceId: member, username: row.username, displayName: row.displayName };
    },
    async createSession(userId) {
      const rawToken = randomUUID() + randomUUID();
      await db.insert(schema.sessions).values({
        id: randomUUID(),
        userId,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
      return { rawToken };
    },
    async findSession(tokenHash) {
      const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).limit(1);
      const session = rows[0];
      if (!session || session.expiresAt.getTime() <= Date.now()) return null;
      const users = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
      const row = users[0];
      if (!row?.username || !row.displayName) return null;
      const member = await membership(row.id);
      if (!member) return null;
      return { userId: row.id, workspaceId: member, username: row.username, displayName: row.displayName };
    },
    async deleteSession(tokenHash) {
      await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
    },
    async getExecution(workspaceId, id) {
      const rows = await db
        .select()
        .from(schema.toolExecutions)
        .where(and(eq(schema.toolExecutions.workspaceId, workspaceId), eq(schema.toolExecutions.id, id)))
        .limit(1);
      const row = rows[0];
      return row ? { ...toExecution(row), toolkitSlug: row.toolkitSlug, action: row.action } : null;
    },
    async insertNote(input) {
      const id = randomUUID();
      const rows = await db.insert(schema.notes).values({ id, ...input }).returning();
      return toNote(rows[0]);
    },
    async searchNotes(workspaceId, kind, query) {
      const rows = await db
        .select()
        .from(schema.notes)
        .where(and(eq(schema.notes.workspaceId, workspaceId), eq(schema.notes.kind, kind)))
        .orderBy(desc(schema.notes.createdAt))
        .limit(100);
      const needle = query.trim().toLowerCase();
      return rows
        .filter((row) => `${row.title}\n${row.body}`.toLowerCase().includes(needle))
        .slice(0, 20)
        .map(toNote);
    },
    async listNotes(workspaceId, kind) {
      const rows = await db
        .select()
        .from(schema.notes)
        .where(and(eq(schema.notes.workspaceId, workspaceId), eq(schema.notes.kind, kind)))
        .orderBy(desc(schema.notes.createdAt))
        .limit(100);
      return rows.map(toNote);
    },
    async getNote(workspaceId, id) {
      const rows = await db
        .select()
        .from(schema.notes)
        .where(and(eq(schema.notes.workspaceId, workspaceId), eq(schema.notes.id, id)))
        .limit(1);
      return rows[0] ? toNote(rows[0]) : null;
    },
    async appendNote(workspaceId, id, text) {
      const current = await store.getNote(workspaceId, id);
      if (!current) return null;
      const body = `${current.body}\n\n${text}`;
      await db.update(schema.notes).set({ body }).where(and(eq(schema.notes.id, id), eq(schema.notes.workspaceId, workspaceId)));
      return { ...current, body };
    },
  };

  async function membership(userId: string): Promise<string | null> {
    const rows = await db.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId)).limit(1);
    return rows[0]?.workspaceId ?? null;
  }

  return store;
}

function toPublic(row: typeof schema.connectedAccounts.$inferSelect): PublicAccount {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    toolkitSlug: row.toolkitSlug,
    scope: row.scope as Scope,
    status: row.status,
    externalLabel: row.externalLabel,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRecord(row: typeof schema.connectedAccounts.$inferSelect): AccountRecord {
  return { ...toPublic(row), encryptedCredentials: row.encryptedCredentials };
}

function toNote(row: typeof schema.notes.$inferSelect) {
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, createdAt: row.createdAt.toISOString() };
}

function toExecution(row: typeof schema.toolExecutions.$inferSelect): ExecutionRecord {
  return { id: row.id, status: row.status, resultRedacted: row.resultRedacted, errorCode: row.errorCode };
}
