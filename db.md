# Database

Postgres holds the workspace, logins, encrypted credentials, notes, chat history, and an audit row for each tool call. SQL is applied in order:

| File | What it adds |
| --- | --- |
| `0001_init.sql` | Workspace, accounts, chat, users, sessions. |
| `0002_login.sql` | `username`, `password_hash`, `display_name`, `google_sub` on `users`. |
| `0003_rls.sql` | Row level security on the public tables, with no anon policy. |
| `0004_notes.sql` | `notes` for saved notes and manuscript chapters. RLS on, no anon policy. |

Drizzle maps the tables the API uses in `packages/db/src/schema.ts`.

Without `DATABASE_URL`, the API keeps the same records in memory. Nothing is written to Postgres until you set the URLs below and run `corepack pnpm db:migrate`.

## This Supabase project

The direct connection string is:

```text
postgresql://postgres:[YOUR-PASSWORD]@db.kwjcqhzczzlsugihybgi.supabase.co:5432/postgres
```

That host and port `5432` are the direct database. Put it in `apps/api/.env` as `DIRECT_URL`. Replace `[YOUR-PASSWORD]` with the database password from the Supabase dashboard. Do not commit that file. `.env` is gitignored.

`DATABASE_URL` is what the API uses while it is running. In the Supabase dashboard, open Connect and copy the Transaction pooler string (port `6543`). If that pooler string is not available yet, the direct string above can be used as `DATABASE_URL` for this one local API process.

The host `db.kwjcqhzczzlsugihybgi.supabase.co` publishes an IPv6 address only. A network without IPv6 cannot open port 5432 on it. The pooler host from the dashboard is the IPv4 path.

Also set `VAULT_MASTER_KEY` before starting the API with `DATABASE_URL`. The API refuses to boot when the database URL is set and the master key is missing.

Changing `schema.ts` does not change Postgres. Drizzle uses that file as the TypeScript map of tables that already exist. A new or renamed column needs a new SQL file and a migrate run:

1. Edit `packages/db/src/schema.ts` so the API and the database description match.
2. Add `packages/db/src/migrations/0005_short_name.sql` with the `alter table` (or the next number). Do not edit a file after it has been applied.
3. From the repo root, with `DIRECT_URL` set, run `corepack pnpm db:migrate`.
4. Restart the API.

The migrator records each filename in `schema_migrations` and skips a file it has already applied. `0001_init.sql` uses `create table if not exists`, so the first run on an existing database is safe. A later file should assume `0001` has already run.

## `schema_migrations`

Created by `corepack pnpm db:migrate`, not by `0001_init.sql`. The API does not read it.

| Column | Need |
| --- | --- |
| `filename` | Primary key. The SQL file name, such as `0001_init.sql`. |
| `applied_at` | When that file was applied. |

## Where tokens live

The raw token is never a column. The API encrypts it with the workspace data key and stores the ciphertext.

| Secret | Table | Column | Stored as |
| --- | --- | --- | --- |
| Gmail, LinkedIn, Calendar, Slack, and the other OAuth tokens | `connected_accounts` | `encrypted_credentials` | Ciphertext. Inside: `access_token`, `refresh_token`, `expires_at`. |
| Telegram bot token, WhatsApp access token and phone number id, Echo secret | `connected_accounts` | `encrypted_credentials` | Ciphertext. Field names match the app (`botToken`, `accessToken`, `phoneNumberId`, or `secret`). |
| Model API key (OpenAI, Gemini, Groq, OpenRouter, Custom) | `llm_connections` | `encrypted_api_key` | Ciphertext. Inside: `apiKey`. |
| OAuth code verifier, kept only until the callback | `oauth_states` | `code_verifier_encrypted` | Ciphertext. Deleted when the callback is consumed. |
| Agent key for Cursor, Claude, or ChatGPT (`lai_...`) | `agent_keys` | `key_hash` | SHA-256 hash. The raw key is shown once and is not stored. `key_prefix` is the visible start of the key. |
| Sign-in session | `sessions` | `token_hash` | Hash of the `loopai_session` cookie. The raw token is not stored. |
| Password | `users` | `password_hash` | Scrypt hash. Not the password. |

`VAULT_MASTER_KEY` is not in the database. It stays in `apps/api/.env`. It unwraps `workspace_keys.wrapped_dek`. That data key decrypts `encrypted_credentials` and `encrypted_api_key`. The browser never receives either key.

`tool_executions.args_redacted` and `result_redacted` are scrubbed before insert. A token that appeared in a result is replaced with `[redacted]`.

## Tables

### `workspaces`

One row per workspace. Today the API creates a single row named "My workspace".

| Column | Need |
| --- | --- |
| `id` | Primary key. Every other workspace-owned row points here. |
| `name` | Stored label. The sidebar shows the signed-in display name. The address uses `<username>_workspace`, which is not this column. |
| `created_at` | When the workspace was created. |

### `workspace_keys`

The encrypted data key for that workspace. One row per workspace.

| Column | Need |
| --- | --- |
| `workspace_id` | Primary key and foreign key to `workspaces.id`. |
| `wrapped_dek` | Data key wrapped by `VAULT_MASTER_KEY`. Required to decrypt credentials. Useless without the master key. |
| `created_at` | When the key was created. |

### `connected_accounts`

One connected app account: a Gmail mailbox, a Telegram bot, a WhatsApp number, and so on.

| Column | Need |
| --- | --- |
| `id` | Primary key. Chat and execute pass this when more than one account exists. |
| `workspace_id` | Which workspace owns the account. |
| `toolkit_slug` | App id, such as `gmail`, `telegram`, `whatsapp`, `google-calendar`, `news`. |
| `scope` | `user` (Connect New) or `workspace` (Connect for my team). |
| `status` | `active` while the account can be used. |
| `external_label` | What the page shows, usually an email or the app name. Not a secret. |
| `expires_at` | When the OAuth access token should be refreshed. Null for API-key apps. |
| `encrypted_credentials` | The token blob. This is the column that holds app tokens. |
| `created_at` | Shown as "minutes ago" on the app page. |
| `updated_at` | Set again on reconnect or token refresh. |

### `oauth_states`

Short-lived row for an OAuth login that has not finished. The callback reads it once and deletes it.

| Column | Need |
| --- | --- |
| `state` | Primary key. Matches the `state` query param Google or LinkedIn sends back. |
| `workspace_id` | Workspace that started the login. |
| `toolkit_slug` | Which app is being connected. |
| `code_verifier_encrypted` | PKCE verifier, plus the account id when this is a reconnect. |
| `scope` | `user` or `workspace`, copied onto the new account. |
| `expires_at` | Login must finish within 10 minutes. |

### `llm_connections`

A model the chat page can call. The key is separate from app tokens.

| Column | Need |
| --- | --- |
| `id` | Primary key. Chat sends this as `llmConnectionId`. |
| `workspace_id` | Which workspace owns the model. |
| `provider` | `openai`, `gemini`, `groq`, `openrouter`, or `compatible`. |
| `model` | Model name sent to the provider, such as `gpt-4o-mini` or `gemini-2.0-flash`. |
| `base_url` | Host for Custom, or the built-in host when one was saved. |
| `encrypted_api_key` | The model key. The list endpoint does not return this column. |
| `created_at` | When the model was added. |

### `agent_keys`

Keys for an outside agent (Cursor, Claude, or ChatGPT on this computer) calling MCP or `/v1/tools/execute`.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `workspace_id` | Workspace the key may act in. |
| `name` | Label chosen when the key was created. |
| `key_hash` | Lookup value. Unique. A request is accepted only when the bearer hash matches and `revoked_at` is null. |
| `key_prefix` | Shown in the dashboard so you can tell keys apart. |
| `created_at` | When the key was created. |
| `revoked_at` | Set when the key is revoked. Null means the key still works. |

### `conversations`

One chat thread.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `workspace_id` | Which workspace owns the thread. |
| `title` | First part of the first message. Shown in the chat list. |
| `created_at` | Order of the list. Newest first. |

### `messages`

One line in a thread. User text and the assistant reply, including a stored error such as `LLM provider returned 401`.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `conversation_id` | Foreign key to `conversations.id`. |
| `role` | `user` or `assistant`. |
| `content` | The text. Tool output is not copied here. Secrets are stripped before insert. |
| `created_at` | Order inside the thread. |

### `tool_executions`

Audit row for one tool call. A repeated `idempotency_key` returns this row instead of calling the vendor again.

| Column | Need |
| --- | --- |
| `id` | Primary key. Returned to the caller. |
| `workspace_id` | Which workspace ran the tool. |
| `connected_account_id` | Account used. Set to null if that account is later deleted. |
| `toolkit_slug` | App that ran. |
| `action` | Action slug, such as `list_messages` or `send_text`. |
| `idempotency_key` | Optional. Unique per workspace so a retry does not send a second email. |
| `args_redacted` | Arguments after secrets are removed. |
| `result_redacted` | Result after secrets are removed. Null when the call failed. |
| `status` | `succeeded` or `failed`. |
| `latency_ms` | How long the call took. |
| `error_code` | Safe error text. Not the vendor body and not the token. |
| `created_at` | When the call finished. |

### `users`

One person who can sign in. A new user joins the single workspace this process opens.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `email` | Optional. Set by Google sign-in. Unique when present. |
| `username` | Sign-in name. Unique. 3 to 32 letters, numbers, dots, or dashes. |
| `password_hash` | Scrypt hash. Null for a Google-only account. |
| `display_name` | Shown in the sidebar. |
| `google_sub` | Google account id. Unique when present. |
| `created_at` | When the user was created. |

### `sessions`

The browser session. Logout deletes the row.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `user_id` | Foreign key to `users.id`. |
| `token_hash` | Hash of the `loopai_session` cookie. The raw token is not stored. |
| `expires_at` | When the session stops working. |
| `created_at` | When the session was created. |

### `workspace_members`

Joins a user to a workspace. Sign-in writes one row. Invites are not a screen yet.

| Column | Need |
| --- | --- |
| `workspace_id` | Workspace. Part of the primary key. |
| `user_id` | User. Part of the primary key. |
| `role` | What that person may do in the workspace. |

### `notes`

A saved note (`kind` `note`) or a manuscript chapter (`kind` `chapter`). Row level security is on and there is no policy, so the Supabase anon role cannot read it. The API connects as `postgres`, which bypasses that.

| Column | Need |
| --- | --- |
| `id` | Primary key. |
| `workspace_id` | Which workspace owns the text. |
| `kind` | `note` or `chapter`. |
| `title` | Shown when the note or chapter is found. |
| `body` | The text. |
| `created_at` | When it was saved. |
