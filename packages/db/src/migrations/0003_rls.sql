-- Supabase exposes public tables through the Data API.
-- The API connects as postgres, which bypasses row level security.
-- Enabling it with no policies blocks the anon and authenticated roles.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'workspaces',
    'workspace_keys',
    'users',
    'sessions',
    'workspace_members',
    'connected_accounts',
    'oauth_states',
    'llm_connections',
    'agent_keys',
    'conversations',
    'messages',
    'tool_executions',
    'schema_migrations'
  ]
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
