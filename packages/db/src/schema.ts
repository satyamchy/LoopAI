import { integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Tables the API queries. Every secret row is scoped by workspace_id.
 * Each signup owns a workspace. A member row is an invite into someone else's.
 */

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceKeys = pgTable("workspace_keys", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  wrappedDek: text("wrapped_dek").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connectedAccounts = pgTable("connected_accounts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  toolkitSlug: text("toolkit_slug").notNull(),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  externalLabel: text("external_label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  toolkitSlug: text("toolkit_slug").notNull(),
  codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const llmConnections = pgTable("llm_connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentKeys = pgTable("agent_keys", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: text("scopes").notNull().default("read"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  clientName: text("client_name"),
  clientVersion: text("client_version"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  googleSub: text("google_sub").unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const emailVerifications = pgTable("email_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const toolApprovals = pgTable("tool_approvals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  conversationId: text("conversation_id"),
  toolkitSlug: text("toolkit_slug").notNull(),
  action: text("action").notNull(),
  connectedAccountId: text("connected_account_id"),
  argsEncrypted: text("args_encrypted").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const notes = pgTable("notes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    connectedAccountId: text("connected_account_id"),
    toolkitSlug: text("toolkit_slug").notNull(),
    action: text("action").notNull(),
    idempotencyKey: text("idempotency_key"),
    argsRedacted: jsonb("args_redacted").notNull(),
    resultRedacted: jsonb("result_redacted"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tool_executions_idempotency_idx").on(table.workspaceId, table.idempotencyKey)],
);
