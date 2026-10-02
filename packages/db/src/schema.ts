import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Tables the API queries. users, sessions, and workspace_members exist in SQL
 * for later login and invites. They are not mapped until that work starts.
 * Every secret row is scoped by workspace_id.
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
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
