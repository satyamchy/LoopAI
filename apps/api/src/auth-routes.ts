import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { authorizeUrl, exchangeCode } from "@loopai/toolkits";
import { hashKey } from "./keys";
import { hashPassword, verifyPassword } from "./passwords";
import type { Store } from "./store";

type AuthDeps = { store: Store; publicUrl: string; webOrigin: string };

const COOKIE = "loopai_session";
const pendingCodes = new Map<string, { userId: string; expires: number }>();

export function mountAuth(app: Hono, deps: AuthDeps) {
  app.get("/v1/auth/config", (c) => c.json({ google: googleReady() }));

  app.post("/v1/auth/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username) return c.json({ error: "Username must be 3 to 32 letters, numbers, dots, or dashes." }, 400);
    if (password.length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    if (await deps.store.findUserByUsername(username)) return c.json({ error: "That username is taken." }, 409);
    const user = await deps.store.createUser({
      username,
      passwordHash: await hashPassword(password),
      displayName: username,
      email: null,
      googleSub: null,
    });
    return sessionResponse(c, deps.store, user.userId, user);
  });

  app.post("/v1/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    const user = username ? await deps.store.findUserByUsername(username) : null;
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ error: "Wrong username or password." }, 401);
    }
    return sessionResponse(c, deps.store, user.userId, user);
  });

  app.post("/v1/auth/logout", async (c) => {
    const token = readCookie(c.req.header("cookie"), COOKIE);
    if (token) await deps.store.deleteSession(hashKey(token));
    c.header("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return c.json({ ok: true });
  });

  app.get("/v1/auth/me", async (c) => {
    const user = await userFromCookie(c.req.header("cookie"), deps.store);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ username: user.username, displayName: user.displayName });
  });

  app.get("/v1/auth/google", async (c) => {
    if (!googleReady()) return c.json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add the login redirect URL in the Google app." }, 400);
    const workspace = await deps.store.ensureWorkspace();
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    await deps.store.insertOAuthState({
      state,
      workspaceId: workspace.id,
      toolkitSlug: "google-login",
      codeVerifierEncrypted: await deps.store.encrypt({ verifier }),
      scope: "user",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const url = authorizeUrl(
      {
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["openid", "email", "profile"],
        clientIdEnv: "GOOGLE_CLIENT_ID",
        clientSecretEnv: "GOOGLE_CLIENT_SECRET",
        extraAuthParams: { prompt: "select_account" },
      },
      { clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri: `${deps.publicUrl}/v1/auth/google/callback`, state, codeVerifier: verifier },
    );
    return c.json({ url });
  });

  app.get("/v1/auth/google/callback", async (c) => {
    const failed = () => c.redirect(`${deps.webOrigin}/login?error=google`);
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state || c.req.query("error")) return failed();
    const saved = await deps.store.takeOAuthState(state);
    if (!saved || saved.toolkitSlug !== "google-login") return failed();
    try {
      const decoded = await deps.store.decrypt(saved.codeVerifierEncrypted);
      const verifier = typeof decoded === "object" && decoded ? String((decoded as { verifier?: string }).verifier ?? "") : "";
      if (!verifier) return failed();
      const tokens = await exchangeCode(
        {
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          tokenUrl: "https://oauth2.googleapis.com/token",
          scopes: ["openid", "email", "profile"],
          clientIdEnv: "GOOGLE_CLIENT_ID",
          clientSecretEnv: "GOOGLE_CLIENT_SECRET",
        },
        { code, redirectUri: `${deps.publicUrl}/v1/auth/google/callback`, codeVerifier: verifier },
      );
      const profile = await googleProfile(tokens.access_token);
      if (!profile) return failed();
      let user = await deps.store.findUserByGoogleSub(profile.sub);
      if (!user) {
        const username = await freeUsername(deps.store, profile.email.split("@")[0] || "google");
        user = await deps.store.createUser({
          username,
          passwordHash: null,
          displayName: profile.name || username,
          email: profile.email,
          googleSub: profile.sub,
        });
      }
      const loginCode = randomBytes(24).toString("base64url");
      pendingCodes.set(loginCode, { userId: user.userId, expires: Date.now() + 2 * 60 * 1000 });
      return c.redirect(`${deps.webOrigin}/login?code=${loginCode}`);
    } catch {
      return failed();
    }
  });

  app.post("/v1/auth/google/finish", async (c) => {
    const body = await c.req.json().catch(() => null);
    const code = typeof body?.code === "string" ? body.code : "";
    const pending = pendingCodes.get(code);
    pendingCodes.delete(code);
    if (!pending || pending.expires < Date.now()) return c.json({ error: "That Google login expired. Try again." }, 400);
    const session = await deps.store.createSession(pending.userId);
    const user = await deps.store.findSession(hashKey(session.rawToken));
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.header("set-cookie", cookieFor(session.rawToken));
    return c.json({ username: user.username, displayName: user.displayName });
  });
}

export async function userFromCookie(header: string | undefined, store: Store) {
  const token = readCookie(header, COOKIE);
  if (!token) return null;
  return store.findSession(hashKey(token));
}

function cookieFor(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`;
}

async function sessionResponse(c: { header: (name: string, value: string) => void; json: (body: unknown) => Response }, store: Store, userId: string, user: { username: string; displayName: string }) {
  const session = await store.createSession(userId);
  c.header("set-cookie", cookieFor(session.rawToken));
  return c.json({ username: user.username, displayName: user.displayName });
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

async function freeUsername(store: Store, seed: string): Promise<string> {
  const base = (seed.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "user").padEnd(3, "x");
  for (let i = 0; i < 5; i += 1) {
    const username = i === 0 ? base : `${base.slice(0, 24)}-${i}`;
    if (!(await store.findUserByUsername(username))) return username;
  }
  return `${base.slice(0, 16)}-${randomBytes(3).toString("hex")}`;
}

function googleReady(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function googleProfile(token: string): Promise<{ sub: string; email: string; name: string } | null> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const json = (await response.json()) as { id?: string; email?: string; name?: string };
  if (!json.id || !json.email) return null;
  return { sub: json.id, email: json.email, name: json.name ?? "" };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
