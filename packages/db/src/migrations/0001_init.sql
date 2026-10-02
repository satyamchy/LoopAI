-- LoopAI schema. Safe to run more than once.
-- users, sessions, and workspace_members are for a later login and invite step.

create table if not exists workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_keys (
  workspace_id text primary key references workspaces (id),
  wrapped_dek text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users (id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces (id),
  user_id text not null references users (id),
  role text not null,
  primary key (workspace_id, user_id)
);

create table if not exists connected_accounts (
  id text primary key,
  workspace_id text not null references workspaces (id),
  toolkit_slug text not null,
  scope text not null check (scope in ('user', 'workspace')),
  status text not null,
  external_label text,
  expires_at timestamptz,
  encrypted_credentials text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists connected_accounts_workspace_idx on connected_accounts (workspace_id);

create table if not exists oauth_states (
  state text primary key,
  workspace_id text not null references workspaces (id),
  toolkit_slug text not null,
  code_verifier_encrypted text not null,
  scope text not null,
  expires_at timestamptz not null
);

create table if not exists llm_connections (
  id text primary key,
  workspace_id text not null references workspaces (id),
  provider text not null,
  model text not null,
  base_url text,
  encrypted_api_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_keys (
  id text primary key,
  workspace_id text not null references workspaces (id),
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists conversations (
  id text primary key,
  workspace_id text not null references workspaces (id),
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations (id),
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

create table if not exists tool_executions (
  id text primary key,
  workspace_id text not null references workspaces (id),
  connected_account_id text references connected_accounts (id) on delete set null,
  toolkit_slug text not null,
  action text not null,
  idempotency_key text,
  args_redacted jsonb not null,
  result_redacted jsonb,
  status text not null,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create unique index if not exists tool_executions_idempotency_idx
  on tool_executions (workspace_id, idempotency_key);

create index if not exists tool_executions_workspace_time_idx
  on tool_executions (workspace_id, created_at desc);
