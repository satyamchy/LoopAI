# Deploy

One process serves the dashboard and the API. The browser uses that origin, so the `loopai_session` cookie stays `SameSite=Lax`. When `API_PUBLIC_URL` is `https`, the cookie is also `Secure`.

Do not bake `apps/api/.env` into the image. Pass the variables at run time.

## Build

```bash
docker build -t loopai .
```

The image runs `tsx src/index.ts`. There is no separate API compile step. The web build is `apps/web/dist`, and the API serves it for every path that is not `/v1`, `/mcp`, or `/docs`.

## Database

Set `DATABASE_URL` to the transaction pooler (port 6543) and `DIRECT_URL` to the session pooler (port 5432). Apply SQL before the first boot:

```bash
corepack pnpm db:migrate
```

`VAULT_MASTER_KEY` is 32 bytes, base64. The API refuses to start when `DATABASE_URL` is set and the key is missing. On startup, a workspace that still has more than one member keeps the earliest user and moves the others onto new empty workspaces.

## Public URL

Set both of these to the same origin:

```text
API_PUBLIC_URL=https://loop.example.com
WEB_ORIGIN=https://loop.example.com
```

In each OAuth app, set the redirect URL to `https://loop.example.com/v1/oauth/callback`. Canva still needs a host it accepts. Google login uses `https://loop.example.com/v1/auth/google/callback`.

The MCP URL is `https://loop.example.com/mcp`. An agent key defaults to read. Write is a checkbox at creation, and that checkbox is the approval for send. Keys can expire after 7, 30, or 90 days.

## Optional

`REDIS_URL` turns on the shared rate limit. Without it, the limit stays in this process.

`SMTP_URL` and `SMTP_FROM` enable password reset and verification mail. `REQUIRE_EMAIL_VERIFICATION=true` blocks sign-in until that mail is confirmed. Leave it unset for a private install.

`ADZUNA_APP_ID` and `ADZUNA_APP_KEY` add Indian listings to job search. Remotive and Arbeitnow still run without them.

`GROQ_API_KEY` is saved into each new workspace. It is not printed.

Reconnect Slack, Outlook, Teams, Jira, Calendar, Sheets, and Twitter after this deploy. Those apps now ask for a wider scope, and an old token will not have it.
