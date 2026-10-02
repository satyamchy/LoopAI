-- Workspace notes and manuscript chapters. The API connects as postgres, which bypasses row level security.
-- No policy is added, so the anon and authenticated roles cannot read this table.

create table if not exists notes (
  id text primary key,
  workspace_id text not null references workspaces (id),
  kind text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table notes enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.notes from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.notes from authenticated';
  end if;
end $$;
