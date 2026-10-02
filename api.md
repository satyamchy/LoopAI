# API

The HTTP API is `apps/api`. It listens on `http://localhost:8787`. The dashboard does not call that port itself. Vite on `http://localhost:5173` forwards any path that starts with `/v1` to the API. See `apps/web/vite.config.ts`.

Swagger UI is [http://localhost:8787/docs](http://localhost:8787/docs). The document is `GET /openapi.json`. Restart the API after a route change so the page matches the server.

Every JSON route is under `/v1`. MCP is `POST /mcp` and the other MCP methods on that same path.

The blocks under each route are responses, unless the heading says **Request**. The full list of bodies the client sends is [Request payloads](#request-payloads). Tool argument objects are [Tool payloads](#tool-payloads).

## Who can call it

The dashboard sends no `Authorization` header. The API then uses the one local workspace.

An outside agent sends `Authorization: Bearer lai_...`. That key is checked against `agent_keys.key_hash`. A bad bearer is `401`. MCP always requires this header. The dashboard routes accept it when it is valid, and reject it when it is present but wrong.

`GET /v1/oauth/callback` is the browser redirect from Google, LinkedIn, Slack, and the other OAuth apps. It does not use a bearer key.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | The body is wrong, the app is the wrong kind, or a required env var is missing. Invalid tool arguments return `{ "error": "Invalid arguments", "fields": ["path"] }` and do not echo the values. |
| 401 | Bearer key missing on MCP, or present and not a known key. |
| 404 | Account, conversation, or reconnect target was not found. |
| 500 | Unexpected failure. Body is `{ "error": "Request failed" }`. The stack stays on the server. |
| 502 | The model or the vendor failed. The message is a status, not the vendor body, and tokens are stripped. |

Broken JSON is `400` with `{ "error": "Invalid JSON" }`.

## Health and catalog

### `GET /v1/health`

`{ "ok": true }`

### `GET /v1/workspace`

Creates the workspace on first call.

```json
{ "id": "uuid", "name": "My workspace" }
```

### `GET /v1/toolkits`

Apps for the grid. `run` functions and tokens are not included.

```json
{
  "toolkits": [
    {
      "slug": "gmail",
      "displayName": "Gmail",
      "description": "Read recent mail and send a plain-text message.",
      "authType": "oauth2",
      "implemented": true,
      "configured": false,
      "setupEnv": "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
      "credentialFields": [],
      "actions": [{ "slug": "list_messages", "description": "...", "risk": "read" }]
    }
  ]
}
```

`authType` is `none`, `api_key`, or `oauth2`. `configured` is false when an OAuth app is missing its client id or secret. `implemented` is false for planned cards such as Notion.

### `GET /v1/providers`

Model hosts for the chat dialog.

```json
{
  "providers": [
    { "id": "openai", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1", "defaultModel": "gpt-4o-mini" },
    { "id": "gemini", "label": "Gemini", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "defaultModel": "gemini-2.0-flash" },
    { "id": "compatible", "label": "Custom", "baseUrl": "", "defaultModel": "" }
  ]
}
```

## Connected apps

A connection response never includes `encrypted_credentials`.

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "toolkitSlug": "telegram",
  "scope": "user",
  "status": "active",
  "externalLabel": "Telegram",
  "expiresAt": null,
  "createdAt": "2026-10-02T08:17:55.110Z"
}
```

`scope` is `user` or `workspace`.

### `GET /v1/connections`

`{ "connections": [ ... ] }`

### `POST /v1/connections`

Saves an API-key app. OAuth apps use `/v1/connections/start` instead.

```json
{
  "toolkit": "telegram",
  "scope": "user",
  "label": "Optional display name",
  "credentials": { "botToken": "at-least-8-chars" }
}
```

Echo still accepts `"secret": "at-least-8-chars"` instead of `credentials`. Each field named by the toolkit must be at least 8 characters. The response is the account object above.

### `POST /v1/connections/start`

Starts OAuth. Body:

```json
{ "toolkit": "gmail", "scope": "user", "accountId": "optional-existing-id" }
```

`accountId` reconnects that row instead of inserting a new one. Response: `{ "url": "https://accounts.google.com/..." }`. The browser goes to that URL.

### `GET /v1/oauth/callback`

Query: `code`, `state`, and sometimes `error`. On success the browser is sent to `http://localhost:5173/connect/apps/<slug>?connected=1`. On failure it is sent to the same page with `?error=oauth`.

### `DELETE /v1/connections/:id`

`{ "ok": true }` or `404`.

## Run a tool

### `POST /v1/tools/execute`

```json
{
  "toolkit": "news",
  "action": "latest",
  "arguments": { "topic": "world" },
  "connectedAccountId": "optional",
  "idempotencyKey": "optional"
}
```

`Idempotency-Key` may be a header instead of a body field. The same key in one workspace returns the stored result and does not call the vendor again.

Success:

```json
{ "id": "uuid", "status": "succeeded", "result": { "topic": "world", "stories": [] } }
```

Failure:

```json
{ "id": "uuid", "status": "failed", "error": "Connect Gmail first." }
```

## Chat

### `GET /v1/llm-connections`

```json
{ "connections": [{ "id": "uuid", "provider": "openai", "model": "gpt-4o-mini", "baseUrl": null }] }
```

The API key is not returned.

### `POST /v1/llm-connections`

```json
{
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "apiKey": "at-least-8-chars",
  "baseUrl": "optional, required for provider compatible"
}
```

Response is the same shape as one item in the list. `provider` defaults to `openai`.

### `GET /v1/conversations`

```json
{ "conversations": [{ "id": "uuid", "title": "hello", "createdAt": "..." }] }
```

Newest first.

### `GET /v1/conversations/:id/messages`

Last 20 messages, oldest first.

```json
{ "messages": [{ "role": "user", "content": "hello" }, { "role": "assistant", "content": "..." }] }
```

`404` when the conversation is not in this workspace.

### `POST /v1/chat`

```json
{
  "llmConnectionId": "uuid",
  "message": "What is in my inbox?",
  "conversationId": "optional"
}
```

Success:

```json
{ "conversationId": "uuid", "reply": "...", "tools": ["gmail__list_messages__abc12345"] }
```

A new thread is created when `conversationId` is omitted. The reply is stored. Tool names are `<toolkit>__<action>` or `<toolkit>__<action>__<8 char account id>` when an account is connected.

Failure is `502`:

```json
{ "error": "LLM provider returned 401", "conversationId": "uuid" }
```

That error is also stored as the assistant message. It does not contain the model key.

## Agent keys

### `GET /v1/agent-keys`

```json
{
  "mcpUrl": "http://localhost:8787/mcp",
  "keys": [{ "id": "uuid", "name": "Cursor", "keyPrefix": "lai_abc12345", "createdAt": "..." }]
}
```

### `POST /v1/agent-keys`

```json
{ "name": "Cursor" }
```

The raw key is returned once:

```json
{ "id": "uuid", "key": "lai_...", "mcpUrl": "http://localhost:8787/mcp" }
```

Later lists show only `keyPrefix`.

## Request payloads

Dashboard calls omit `Authorization`. An agent sends `Authorization: Bearer lai_...`. JSON bodies use `Content-Type: application/json`.

| Route | Body the client sends |
| --- | --- |
| `GET /v1/health` | None. |
| `GET /v1/workspace` | None. |
| `GET /v1/toolkits` | None. |
| `GET /v1/providers` | None. |
| `GET /v1/connections` | None. |
| `POST /v1/connections` | API-key connect. See below. |
| `POST /v1/connections/start` | OAuth start. See below. |
| `GET /v1/oauth/callback` | None. Query: `code`, `state`, and sometimes `error`. |
| `DELETE /v1/connections/:id` | None. |
| `POST /v1/tools/execute` | Tool call. See below. |
| `GET /v1/llm-connections` | None. |
| `POST /v1/llm-connections` | Model key. See below. |
| `GET /v1/conversations` | None. |
| `GET /v1/conversations/:id/messages` | None. |
| `POST /v1/chat` | Chat turn. See below. |
| `GET /v1/agent-keys` | None. |
| `POST /v1/agent-keys` | `{ "name": "Cursor" }`. `name` may be omitted. |
| `POST /mcp` | JSON-RPC. See below. Bearer required. |

### `POST /v1/connections`

**Request**

```json
{
  "toolkit": "telegram",
  "scope": "user",
  "label": "Optional display name",
  "credentials": { "botToken": "at-least-8-chars" }
}
```

`scope` is `user` or `workspace`. Echo accepts `"secret"` instead of `credentials`. WhatsApp sends both fields:

```json
{
  "toolkit": "whatsapp",
  "scope": "user",
  "credentials": {
    "accessToken": "at-least-8-chars",
    "phoneNumberId": "at-least-8-chars"
  }
}
```

### `POST /v1/connections/start`

**Request**

```json
{ "toolkit": "gmail", "scope": "user", "accountId": "optional-existing-id" }
```

Omit `accountId` to add an account. Send it to reconnect that row.

### `POST /v1/tools/execute`

**Request**

```json
{
  "toolkit": "news",
  "action": "latest",
  "arguments": { "topic": "world", "limit": 5 },
  "connectedAccountId": "optional-account-id",
  "idempotencyKey": "optional-unique-string"
}
```

`Idempotency-Key` may be that same string as a header. `arguments` is the tool payload in the next section. `connectedAccountId` is required when more than one account of that app is connected.

### `POST /v1/llm-connections`

**Request**

```json
{
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "apiKey": "at-least-8-chars",
  "baseUrl": "https://example.com/v1"
}
```

`provider` defaults to `openai`. `baseUrl` is required when `provider` is `compatible`.

### `POST /v1/chat`

**Request**

```json
{
  "llmConnectionId": "uuid",
  "message": "What is in my inbox?",
  "conversationId": "optional-existing-thread"
}
```

Omit `conversationId` to start a thread.

### `POST /mcp`

**Request** to initialize. Header `Accept: application/json, text/event-stream` and `Authorization: Bearer lai_...`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "cursor", "version": "0.0.1" }
  }
}
```

## Tool payloads

These objects are `arguments` inside `POST /v1/tools/execute`. Omitted optional fields use the toolkit default.

| Toolkit | Action | Arguments |
| --- | --- | --- |
| `echo` | `echo` | `{ "message": "hello" }` — 1 to 500 characters. Needs the echo connection. |
| `gmail` | `list_messages` | `{ "maxResults": 5 }` — optional, 1 to 10. |
| `gmail` | `send_email` | `{ "to": "a@b.c", "subject": "Hi", "body": "Plain text" }`. |
| `slack` | `list_channels` | `{ "limit": 20 }` — optional, 1 to 100. |
| `outlook` | `list_messages` | `{ "top": 5 }` — optional, 1 to 10. |
| `google-drive` | `list_files` | `{ "pageSize": 10 }` — optional, 1 to 20. |
| `teams` | `list_teams` | `{}`. |
| `jira` | `list_issues` | `{ "maxResults": 5 }` — optional, 1 to 10. |
| `github` | `list_repos` | `{ "perPage": 10 }` — optional, 1 to 20. |
| `linkedin` | `get_profile` | `{}`. |
| `google-calendar` | `list_events` | `{ "maxResults": 5 }` — optional, 1 to 10. |
| `whatsapp` | `send_text` | `{ "to": "9198XXXXXXX", "body": "Hello" }`. `to` is 8 to 20 characters. |
| `telegram` | `get_me` | `{}`. |
| `telegram` | `get_updates` | `{ "limit": 5 }` — optional, 1 to 10. |
| `telegram` | `send_message` | `{ "chatId": "123456", "text": "Hello" }`. `text` is at most 4000 characters. |
| `news` | `latest` | `{ "topic": "world", "limit": 5 }`. `topic` is `world`, `technology`, or `business`. Both fields optional. |
| `patna-hc` | `search_by_party` | `{ "partyName": "Kumar" }` — 2 to 200 characters. No account. |
| `patna-hc` | `paste_order` | `{ "text": "Order dated 02/10/2026" }` — up to 20000 characters. No account. |
| `hindi-render` | `case` | See below. No account. |

`hindi-render` / `case` quotes only values that already appear inside `sourceText`:

```json
{
  "sourceText": "Order dated 02/10/2026 in CR No. 12/2024",
  "status": null,
  "nextDate": null,
  "dateMentioned": "02/10/2026",
  "orderText": null,
  "caseNumber": "12/2024",
  "sourceUrl": null
}
```

## MCP

`/mcp` speaks the Model Context Protocol over HTTP. `Authorization: Bearer lai_...` is required. Tools registered there are the same actions as chat, for accounts already connected in the workspace. The initialize body is in [Request payloads](#request-payloads).
