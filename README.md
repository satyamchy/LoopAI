# LoopAI

LoopAI is a local action gateway. A model can call Gmail, Calendar, LinkedIn, Telegram, WhatsApp, and the other connected apps. The model never receives the OAuth token or the API key. The API decrypts a credential, calls the vendor, and returns a redacted result.

## Frontend and backend

They are two programs. Neither imports the other.

| | Frontend | Backend |
| --- | --- | --- |
| Folder | `apps/web` | `apps/api` |
| Package | `@loopai/web` | `@loopai/api` |
| What it is | React pages in the browser | Hono server on Node |
| Address | `http://localhost:5173` | `http://localhost:8787` |
| Holds tokens | No | Yes, encrypted |

`packages/core`, `packages/vault`, `packages/db`, and `packages/toolkits` are libraries. They are not servers. Only the API imports them. The browser never sees those packages.

The pages are `apps/web/src/pages`. Each page calls `api()` in `apps/web/src/api.ts`, which is `fetch("/v1/...")`. Vite proxies `/v1` to port 8787, so the browser stays on 5173. Routes are in `apps/api/src/app.ts` and `apps/api/src/auth-routes.ts`. The full list is [api.md](api.md). Tables are in [db.md](db.md). How each app authenticates is [packages/toolkits/README.md](packages/toolkits/README.md). To run one process off this computer, see [DEPLOY.md](DEPLOY.md).

A click on Connect follows this path:

1. `ConnectApps.tsx` or `AppDetail.tsx` calls `POST /v1/connections` or `POST /v1/connections/start`.
2. The API encrypts the secret, or returns the provider login URL.
3. The provider later redirects to `GET /v1/oauth/callback` on port 8787.
4. The API stores the token and sends the browser back to `http://localhost:5173/connect/apps/<slug>`, which then opens `http://localhost:5173/<username>_workspace/~/connect/apps/<slug>`.

Chat follows the same split. `Chat.tsx` sends `POST /v1/chat`. The API decrypts the model key, calls the model, runs tools, and returns text. The page renders assistant replies as Markdown. The chat list in the sidebar appears only on the chat route. Delete calls `DELETE /v1/conversations/:id`.

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

Open `http://localhost:5173`. Signed out, that is the start page. **Log in** and **Get started** open a sign-in dialog on that page. After sign-in the address is `http://localhost:5173/<username>_workspace/~/connect/clients/chatgpt`. Apps, chat, help, and settings sit under the same `/<username>_workspace/~/` prefix. The signed-in pages use a warm dark background with the orange accent. Chat keeps its own dark pane, and its list appears only there. Delete on a chat removes that conversation. The API is `http://localhost:8787` and is reached through the proxy. Swagger UI is `http://localhost:8787/docs`.

Stop both with Ctrl+C in that terminal. Run one side alone with `corepack pnpm --filter @loopai/web dev` or `corepack pnpm --filter @loopai/api dev`. The pages need both. To run this off the computer, see [DEPLOY.md](DEPLOY.md).

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

## Connect an agent

Open **Connect my agent**. Pick Cursor, Claude, or ChatGPT, name a key, and copy the MCP block once. The raw key is not shown again.

ChatGPT on this computer uses the same URL and bearer header. The ChatGPT website cannot reach `localhost`. The block works only while the API is running here.

From a client on this machine:

```bash
claude mcp add --transport http loopai http://localhost:8787/mcp --header "Authorization: Bearer YOUR_KEY"
```

Replace `YOUR_KEY` with the key shown once at creation. Settings lists the name and prefix under **Sessions & API key**.

## Check it

```bash
corepack pnpm test
```

That includes the agent checks: a job prompt calls `jobs__search`, a note prompt calls `notes__save`, a plain prompt calls nothing, and an intro email with no Gmail account returns the connect-Gmail error. The model is fake. Nothing is sent.

```bash
corepack pnpm test:live
```

That calls Groq and the public job boards. It needs `GROQ_API_KEY` in `apps/api/.env`.

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
