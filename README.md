# LoopAI

LoopAI is a local action gateway. A model can call Gmail, Calendar, LinkedIn, Telegram, WhatsApp, and the other connected apps. The model never receives the OAuth token or the API key. The API decrypts a credential, calls the vendor, and returns a redacted result.

## How to read the repo

Start at the edges, then follow one request inward.

| Path | What it is |
| --- | --- |
| `apps/web` | The dashboard. Connect Apps, the app page, Connect my agent, and Chat. |
| `apps/api/src/app.ts` | HTTP routes. This is the only place that decrypts credentials. |
| `apps/api/src/run-tool-loop.ts` | Chat. It calls an OpenAI-compatible endpoint and runs tools. No LangChain. |
| `packages/toolkits` | One file per app. This is where a new tool goes. |
| `packages/vault` | AES-256-GCM. The master key never goes in the database. |
| `packages/db` | Drizzle schema and the SQL migration for Supabase. |
| `packages/core` | Shared types and the redaction rules. |

A chat turn does this: the browser sends the message and a model id. The API loads that model's encrypted key, builds a tool list from connected accounts, and calls `runToolLoop`. When the model asks for a tool, `performExecute` decrypts one account, refreshes the OAuth token if it is about to expire, runs the action, and stores a redacted audit row.

## Run it

```bash
corepack pnpm install
corepack pnpm dev
```

The dashboard is `http://localhost:5173`. The API is `http://localhost:8787`.

With no `apps/api/.env`, the API keeps data in memory. Restarting the API clears connections. For a durable workspace, copy `apps/api/.env.example` to `apps/api/.env`, set `DATABASE_URL`, `DIRECT_URL`, and `VAULT_MASTER_KEY`, then run `corepack pnpm db:migrate`.

## Connect an app

Open the app from the grid. Gmail, LinkedIn, and Google Calendar use the same page.

1. Set the client id and secret in `apps/api/.env`. Gmail and Calendar share `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. LinkedIn uses `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
2. In the provider's OAuth app, set the redirect URL to `http://localhost:8787/v1/oauth/callback`.
3. Restart the API.
4. Open the app page. **Connect New** is your account. **Connect for my team** shares it with the workspace.
5. After Google or LinkedIn sends you back, the account shows as Active, with Reconnect and Delete. **Connect another account** starts a second login. Reconnect updates that same account.
6. **Available actions** lists what chat can call. Search filters that list.

Telegram and WhatsApp do not use OAuth. Open their app page and paste the credentials there. Telegram needs the bot token from BotFather. WhatsApp needs a Cloud API access token and a phone number id. News needs nothing.

If a client id is missing, the button stays disabled and the page names the env vars. A refused login returns to the app page with an error. The error does not include the token.

## Add a tool

1. Add `packages/toolkits/src/<name>.ts`. Export a `Toolkit`. Copy `gmail.ts` for OAuth, `telegram.ts` for a token, or `news.ts` for a public feed.
2. Use `defineAction`. The `input` is a Zod object. `run` returns only the fields the model should see.
3. OAuth: set `oauth` with `clientIdEnv` and `clientSecretEnv`. Google apps can call `googleOAuth(scopes)`.
4. Token apps: set `authType: "api_key"` and `credentialFields`. The first field is passed into `run` as the token. Do not put that token in the return value or in an `Error`.
5. Register the export in the `toolkits` array in `packages/toolkits/src/index.ts`.
6. Remove the slug from the `planned` list in `catalog.ts` if it was a placeholder.
7. Add a test in `toolkits.test.ts` that mocks `fetch` and asserts the token is absent from the result and from any thrown message.
8. Run `corepack pnpm test`.

The app page, the chat tool list, and MCP pick the toolkit up from that array. No database row is required for a new tool.

## Add a model

Open Chat and choose **Add model**. OpenAI, Gemini, Groq, and OpenRouter already have a base URL. Custom is any host that accepts `POST {base}/chat/completions` with a bearer key.

To add a named provider, append one object to `modelProviders` in `apps/api/src/run-tool-loop.ts`:

```ts
{ id: "example", label: "Example", baseUrl: "https://example.com/v1", defaultModel: "example-model" }
```

The chat dialog reads `GET /v1/providers`, so the new provider appears without a UI change. A host that is not in that list still works as Custom with its base URL.

## Errors

- A bad tool argument returns 400 and the field names, not the values.
- A vendor failure returns 502. The message is the status, not the response body.
- Chat failures are scrubbed with the same secret list as tool results.
- The API error handler returns "Request failed" for unexpected errors and does not send a stack to the browser.
- OAuth failures redirect to the app page. They do not echo the provider body.
