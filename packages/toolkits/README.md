# How apps connect

Each file in `src/` is one app. Register it in `src/index.ts`. The dashboard reads that list. Chat, the HTTP API, and `/mcp` all run an action through `executeToolkit`. A secret is encrypted in `connected_accounts` and is not returned to the browser.

OAuth apps stay disabled until both client env vars are set in `apps/api/.env`. Restart the API after changing them. The redirect URL is `http://localhost:8787/v1/oauth/callback`, except Canva, which uses `http://127.0.0.1:8787/v1/oauth/callback`.

| App | File | Auth | What you set | Action |
| --- | --- | --- | --- | --- |
| LoopAI Echo | `src/echo.ts` | API key | Any secret of 8+ characters on the app page | `echo` repeats a message and does not return the secret |
| Gmail | `src/gmail.ts` | OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `list_messages`, `send_email` |
| Slack | `src/slack.ts` | OAuth | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | `list_channels` |
| Outlook | `src/outlook.ts` | OAuth | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `list_messages` |
| Google Drive | `src/google-drive.ts` | OAuth | Same Google pair as Gmail | `list_files` |
| Microsoft Teams | `src/teams.ts` | OAuth | Same Microsoft pair as Outlook | `list_teams` |
| Jira | `src/jira.ts` | OAuth | `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` | `list_issues` |
| GitHub | `src/github.ts` | OAuth | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `list_repos` |
| LinkedIn | `src/linkedin.ts` | OAuth | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `get_profile` |
| Google Calendar | `src/google-calendar.ts` | OAuth | Same Google pair as Gmail | `list_events` |
| WhatsApp | `src/whatsapp.ts` | API key | Cloud API token and phone number id on the app page | `send_text` |
| Telegram | `src/telegram.ts` | API key | Bot token on the app page | `get_me`, `get_updates`, `send_message` |
| News | `src/news.ts` | None | Nothing | `latest` reads a public RSS feed |
| Patna High Court | `src/patna-hc.ts` | None | Nothing | `search_by_party`, `paste_order` |
| Hindi | `src/hindi-render.ts` | None | Nothing | `case` quotes only text that was already fetched |
| Perplexity | `src/perplexity.ts` | API key | Perplexity API key on the app page | `ask` calls `https://api.perplexity.ai/chat/completions` |
| Supabase | `src/supabase.ts` | API key | Project URL `https://<ref>.supabase.co` and an API key on the app page | `select_rows` calls PostgREST `GET /rest/v1/<table>` |
| Custom MCP | `src/custom-mcp.ts` | API key | Server URL, optional bearer token, on the app page | `list_tools`, `call_tool` speak MCP over HTTP |
| Google Sheets | `src/google-sheets.ts` | OAuth | Same Google pair as Gmail | `read_values` |
| Twitter | `src/twitter.ts` | OAuth | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | `get_me` |
| Profile | `src/profile.ts` | API key | Name, email, phone, note, subject, and body on the app page | `read`, `send_intro` sends one email through the connected Gmail account |
| Jobs | `src/jobs.ts` | None | Nothing | `search` reads public Remotive and Arbeitnow listings |
| Notes | `src/notes.ts` | None | Nothing | `save`, `search` |
| Manuscript | `src/manuscript.ts` | None | Nothing | `add_chapter`, `list_chapters`, `read_chapter`, `append` |
| Canva | `src/canva.ts` | OAuth | `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | `create_design`, `import_manuscript`, `export_design` |

Notion, HubSpot, and Linear are cards only. They have no file yet, so Connect stays disabled.

## Supabase

Use a project other than the one in `DATABASE_URL`. That database holds password hashes and encrypted app credentials. The toolkit refuses a project URL whose ref matches `DATABASE_URL`.

## Custom MCP

The server must accept HTTP POST JSON-RPC (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`), protocol `2025-03-26`. `http://127.0.0.1` is allowed. `169.254.169.254` and `metadata.google.internal` are not.

## Canva

Register `http://127.0.0.1:8787/v1/oauth/callback` in the Canva integration. Canva rejects `localhost`. The API must be reachable on that host. The token call uses HTTP Basic, not a form secret.

## Add an app

1. Copy `src/echo.ts` for an API key, or `src/gmail.ts` for OAuth.
2. Export a `Toolkit` and append it in `src/index.ts`.
3. Add a row to the table above and to the tool payload table in `api.md`.
4. An API-key field must be at least 8 characters. Mark a URL with `secret: false` and an optional token with `optional: true`.
