---
name: loopai
description: >-
  Work on the LoopAI local action gateway. Use when adding or connecting an
  app, toolkit, OAuth client, Supabase, Perplexity, Custom MCP, database
  migration, startup log, or vault secret in this repository.
---

# LoopAI

LoopAI is a local action gateway. `apps/web` is the Vite dashboard. `apps/api` is the Hono API on port 8787. Toolkits live in `packages/toolkits`.

## Connect an app

Read [packages/toolkits/README.md](../../../packages/toolkits/README.md) before adding or changing an app. That file is the list of how each app authenticates and which action it runs.

- OAuth Connect stays disabled until both client env vars are set. Do not mark `configured: true` without them.
- API keys are entered on the app page and encrypted. Never log them, return them, or commit `apps/api/.env`.
- Gmail, Drive, and Calendar share `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Outlook and Teams share the Microsoft pair.
- Perplexity, Supabase, and Custom MCP are API-key apps. They do not use env client ids.
- The Supabase toolkit must not target the LoopAI database. `select_rows` refuses a project ref that matches `DATABASE_URL`.
- Custom MCP may call localhost. It must reject cloud metadata hosts.

## Database

`DATABASE_URL` is the transaction pooler, port 6543, user `postgres.<project-ref>`. `DIRECT_URL` is the session pooler on the same host, port 5432. Migrations use `DIRECT_URL`. The direct `db.<ref>.supabase.co` host is IPv6-only.

New SQL goes in `packages/db/src/migrations/` as the next numbered file. Apply it with the db package migrate script. Public tables need row level security enabled. The API connects as `postgres`, which bypasses it. Do not add a policy that exposes `users`, `sessions`, or `connected_accounts` to the `anon` role.

## Startup

On listen, the API logs the database host, whether the vault master key is set, whether `REDIS_URL` is set, Google login, and every app as `ready`, `needs <ENV>`, or `planned`. Log the host only. Do not log a URL that contains a password.

## Do not

- Install `@supabase/supabase-js` or `drizzle-kit`. The database client is already `postgres.js` and Drizzle.
- Print `VAULT_MASTER_KEY`, database passwords, OAuth secrets, or API keys.
- Commit `apps/api/.env`.
