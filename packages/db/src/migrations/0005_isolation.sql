-- One workspace per owner. Extra members are moved by the API, which can wrap a new data key.
-- Login verifiers may exist before a user does, so the OAuth state workspace is optional.

alter table sessions add column if not exists workspace_id text references workspaces (id);
alter table agent_keys add column if not exists scopes text not null default 'read';
alter table agent_keys add column if not exists expires_at timestamptz;
alter table users add column if not exists email_verified_at timestamptz;
alter table connected_accounts add column if not exists created_by text;
alter table oauth_states alter column workspace_id drop not null;

create table if not exists password_resets (
  id text primary key,
  user_id text not null references users (id),
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table if not exists email_verifications (
  id text primary key,
  user_id text not null references users (id),
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table if not exists tool_approvals (
  id text primary key,
  workspace_id text not null references workspaces (id),
  conversation_id text,
  toolkit_slug text not null,
  action text not null,
  connected_account_id text,
  args_encrypted text not null,
  summary text not null,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

do $$
declare
  tbl text;
begin
  foreach tbl in array array['password_resets', 'email_verifications', 'tool_approvals']
  loop
    execute format('alter table public.%I enable row level security', tbl);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', tbl);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', tbl);
    end if;
  end loop;
end $$;
