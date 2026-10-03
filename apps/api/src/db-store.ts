import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AccountScope } from "@loopai/core";
import { createDb, schema } from "@loopai/db";
import { decryptJson, encryptJson, newDataKey, unwrapKey, wrapKey } from "@loopai/vault";
import type { AccountRecord, ApprovalRecord, ExecutionRecord, MemberRole, OAuthStateRecord, PublicAccount, Store } from "./store";

type Scope = AccountScope;

/**
 * Supabase-backed store. Each workspace has its own data key.
 * Credential plaintext exists only in the return value of decrypt.
 * A null workspace id uses the master key, for a login verifier that exists before a user does.
 */
export function createSupabaseStore(databaseUrl: string, masterKey: Buffer): Store {
  const db = createDb(databaseUrl);
  const deks = new Map<string, Buffer>();

  async function dekFor(workspaceId: string): Promise<Buffer> {
    const cached = deks.get(workspaceId);
    if (cached) return cached;
    const keys = await db.select().from(schema.workspaceKeys).where(eq(schema.workspaceKeys.workspaceId, workspaceId)).limit(1);
    if (!keys[0]) throw new Error("Workspace is missing its encryption key.");
    const dek = unwrapKey(keys[0].wrappedDek, masterKey);
    deks.set(workspaceId, dek);
    return dek;
  }

  async function createWorkspace(name: string): Promise<{ id: string; name: string }> {
    const id = randomUUID();
    const dek = newDataKey();
    await db.insert(schema.workspaces).values({ id, name });
    await db.insert(schema.workspaceKeys).values({ workspaceId: id, wrappedDek: wrapKey(dek, masterKey) });
    deks.set(id, dek);
    return { id, name };
  }

  async function membership(userId: string, workspaceId?: string | null): Promise<{ workspaceId: string; role: MemberRole } | null> {
    const rows = await db.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));
    const match = workspaceId ? rows.find((row) => row.workspaceId === workspaceId) : rows.find((row) => row.role === "owner") ?? rows[0];
    if (!match) return null;
    return { workspaceId: match.workspaceId, role: match.role === "member" ? "member" : "owner" };
  }

  const store: Store = {
    async ensureWorkspace() {
      const existing = await db.select().from(schema.workspaces).limit(1);
      if (existing[0]) return { id: existing[0].id, name: existing[0].name };
      return createWorkspace("My workspace");
    },
    async repairSharedVaults() {
      const members = await db.select().from(schema.workspaceMembers);
      const people = await db.select().from(schema.users);
      const grouped = new Map<string, { userId: string; createdAt: number }[]>();
      for (const member of members) {
        const user = people.find((item) => item.id === member.userId);
        const list = grouped.get(member.workspaceId) ?? [];
        list.push({ userId: member.userId, createdAt: user?.createdAt.getTime() ?? 0 });
        grouped.set(member.workspaceId, list);
      }
      let moved = 0;
      for (const [workspaceId, list] of grouped) {
        if (list.length < 2) continue;
        list.sort((a, b) => a.createdAt - b.createdAt);
        for (const extra of list.slice(1)) {
          const created = await createWorkspace("My workspace");
          await db.delete(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, extra.userId)));
          await db.insert(schema.workspaceMembers).values({ workspaceId: created.id, userId: extra.userId, role: "owner" });
          await db.update(schema.sessions).set({ workspaceId: created.id }).where(eq(schema.sessions.userId, extra.userId));
          moved += 1;
        }
      }
      return moved;
    },
    async ping() {
      await db.execute(sql`select 1`);
    },
    async encrypt(workspaceId, value) {
      const key = workspaceId ? await dekFor(workspaceId) : masterKey;
      return encryptJson(value, key);
    },
    async decrypt(workspaceId, payload) {
      const key = workspaceId ? await dekFor(workspaceId) : masterKey;
      return decryptJson(payload, key);
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
          createdBy: input.createdBy ?? null,
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
    async deleteAccount(workspaceId, id, actor) {
      const rows = await db
        .select()
        .from(schema.connectedAccounts)
        .where(and(eq(schema.connectedAccounts.id, id), eq(schema.connectedAccounts.workspaceId, workspaceId)))
        .limit(1);
      const row = rows[0];
      if (!row) return "missing";
      if (actor?.role === "member" && row.createdBy && row.createdBy !== actor.userId) return "forbidden";
      await db.delete(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, id));
      return "ok";
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
    async getExecution(workspaceId, id) {
      const rows = await db
        .select()
        .from(schema.toolExecutions)
        .where(and(eq(schema.toolExecutions.workspaceId, workspaceId), eq(schema.toolExecutions.id, id)))
        .limit(1);
      const row = rows[0];
      return row ? { ...toExecution(row), toolkitSlug: row.toolkitSlug, action: row.action } : null;
    },
    async listExecutions(workspaceId) {
      const rows = await db
        .select()
        .from(schema.toolExecutions)
        .where(eq(schema.toolExecutions.workspaceId, workspaceId))
        .orderBy(desc(schema.toolExecutions.createdAt))
        .limit(50);
      return rows.map((row) => ({
        ...toExecution(row),
        toolkitSlug: row.toolkitSlug,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async insertApproval(input) {
      const id = randomUUID();
      await db.insert(schema.toolApprovals).values({
        id,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        toolkitSlug: input.toolkitSlug,
        action: input.action,
        connectedAccountId: input.connectedAccountId,
        argsEncrypted: input.argsEncrypted,
        summary: input.summary,
        status: "pending",
        expiresAt: new Date(input.expiresAt),
      });
      return { ...input, id, status: "pending" };
    },
    async getApproval(workspaceId, id) {
      const rows = await db
        .select()
        .from(schema.toolApprovals)
        .where(and(eq(schema.toolApprovals.workspaceId, workspaceId), eq(schema.toolApprovals.id, id)))
        .limit(1);
      return rows[0] ? toApproval(rows[0]) : null;
    },
    async setApprovalStatus(id, status) {
      await db.update(schema.toolApprovals).set({ status }).where(eq(schema.toolApprovals.id, id));
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
      await db.insert(schema.agentKeys).values({
        id,
        ...input,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      });
      return { id };
    },
    async listAgentKeys(workspaceId) {
      const rows = await db
        .select()
        .from(schema.agentKeys)
        .where(and(eq(schema.agentKeys.workspaceId, workspaceId), isNull(schema.agentKeys.revokedAt)));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        scopes: row.scopes,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        clientName: row.clientName,
        clientVersion: row.clientVersion,
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async findAgentKey(keyHash) {
      const rows = await db
        .select()
        .from(schema.agentKeys)
        .where(and(eq(schema.agentKeys.keyHash, keyHash), isNull(schema.agentKeys.revokedAt)))
        .limit(1);
      const row = rows[0];
      if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
      return { workspaceId: row.workspaceId, scopes: row.scopes.split(",").filter(Boolean) };
    },
    async touchAgentKey(keyHash, client) {
      await db
        .update(schema.agentKeys)
        .set({
          lastSeenAt: new Date(),
          ...(client ? { clientName: client.name, clientVersion: client.version } : {}),
        })
        .where(and(eq(schema.agentKeys.keyHash, keyHash), isNull(schema.agentKeys.revokedAt)));
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
        .limit(40);
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
      const workspace = await createWorkspace(`${input.displayName}'s workspace`);
      const id = randomUUID();
      await db.insert(schema.users).values({
        id,
        username: input.username,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        email: input.email,
        googleSub: input.googleSub,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      });
      await db.insert(schema.workspaceMembers).values({ workspaceId: workspace.id, userId: id, role: "owner" });
      return {
        userId: id,
        workspaceId: workspace.id,
        username: input.username,
        displayName: input.displayName,
        role: "owner" as const,
        email: input.email,
        emailVerified: Boolean(input.emailVerified),
      };
    },
    async findUserByUsername(username) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
      const row = rows[0];
      const member = row ? await membership(row.id) : null;
      if (!row?.username || !row.displayName || !member) return null;
      return { ...toSession(row, member), passwordHash: row.passwordHash };
    },
    async findUserByGoogleSub(googleSub) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.googleSub, googleSub)).limit(1);
      const row = rows[0];
      const member = row ? await membership(row.id) : null;
      if (!row?.username || !row.displayName || !member) return null;
      return toSession(row, member);
    },
    async listMemberships(userId) {
      const rows = await db.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));
      const named = await Promise.all(rows.map(async (row) => {
        const workspaces = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, row.workspaceId)).limit(1);
        return {
          workspaceId: row.workspaceId,
          name: workspaces[0]?.name ?? "Workspace",
          role: (row.role === "member" ? "member" : "owner") as MemberRole,
        };
      }));
      return named;
    },
    async inviteMember(workspaceId, username) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
      const user = rows[0];
      if (!user) return { ok: false as const, error: "No account uses that username." };
      const existing = await db
        .select()
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, user.id)))
        .limit(1);
      if (existing[0]) return { ok: false as const, error: "That person is already in this workspace." };
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role: "member" });
      return { ok: true as const, username: user.username ?? username, role: "member" as const };
    },
    async setSessionWorkspace(tokenHash, workspaceId) {
      const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).limit(1);
      const session = rows[0];
      if (!session) return false;
      const member = await membership(session.userId, workspaceId);
      if (!member) return false;
      await db.update(schema.sessions).set({ workspaceId }).where(eq(schema.sessions.id, session.id));
      return true;
    },
    async createPasswordReset(userId) {
      const raw = randomBytes(24).toString("base64url");
      await db.insert(schema.passwordResets).values({
        id: randomUUID(),
        userId,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      return raw;
    },
    async takePasswordReset(tokenHash) {
      const removed = await db.delete(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, tokenHash)).returning();
      const row = removed[0];
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return row.userId;
    },
    async setPassword(userId, passwordHash) {
      await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
    },
    async createEmailVerification(userId) {
      const raw = randomBytes(24).toString("base64url");
      await db.insert(schema.emailVerifications).values({
        id: randomUUID(),
        userId,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      return raw;
    },
    async takeEmailVerification(tokenHash) {
      const removed = await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.tokenHash, tokenHash)).returning();
      const row = removed[0];
      if (!row || row.expiresAt.getTime() <= Date.now()) return false;
      await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, row.userId));
      return true;
    },
    async createSession(userId) {
      const member = await membership(userId);
      if (!member) throw new Error("User has no workspace.");
      const rawToken = randomUUID() + randomUUID();
      await db.insert(schema.sessions).values({
        id: randomUUID(),
        userId,
        workspaceId: member.workspaceId,
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
      const member = row ? await membership(row.id, session.workspaceId) : null;
      if (!row?.username || !row.displayName || !member) return null;
      return toSession(row, member);
    },
    async deleteSession(tokenHash) {
      await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
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

  return store;
}

function toSession(row: typeof schema.users.$inferSelect, member: { workspaceId: string; role: MemberRole }) {
  return {
    userId: row.id,
    workspaceId: member.workspaceId,
    username: row.username ?? "",
    displayName: row.displayName ?? "",
    role: member.role,
    email: row.email,
    emailVerified: Boolean(row.emailVerifiedAt),
  };
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
  return { ...toPublic(row), encryptedCredentials: row.encryptedCredentials, createdBy: row.createdBy };
}

function toNote(row: typeof schema.notes.$inferSelect) {
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, createdAt: row.createdAt.toISOString() };
}

function toExecution(row: typeof schema.toolExecutions.$inferSelect): ExecutionRecord {
  return { id: row.id, status: row.status, resultRedacted: row.resultRedacted, errorCode: row.errorCode };
}

function toApproval(row: typeof schema.toolApprovals.$inferSelect): ApprovalRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    conversationId: row.conversationId,
    toolkitSlug: row.toolkitSlug,
    action: row.action,
    connectedAccountId: row.connectedAccountId,
    argsEncrypted: row.argsEncrypted,
    summary: row.summary,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  };
}
