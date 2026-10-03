import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { authorizeUrl, exchangeCode } from "@loopai/toolkits";
import { hashKey } from "./keys";
import { mailConfigured, sendMail } from "./mail";
import { hashPassword, verifyPassword } from "./passwords";
import { allow, clientIp } from "./rate-limit";
import { seedGroq } from "./seed-model";
import type { Store } from "./store";

type AuthDeps = { store: Store; publicUrl: string; webOrigin: string };

const COOKIE = "loopai_session";
const pendingCodes = new Map<string, { userId: string; expires: number }>();
const RESET_NOTE = "If that account exists, we sent a reset link.";

export function mountAuth(app: Hono, deps: AuthDeps) {
  app.get("/v1/auth/config", (c) => c.json({ google: googleReady(), email: mailConfigured() }));

  app.post("/v1/auth/register", async (c) => {
    if (!(await allow(`register:${clientIp(c.req.header("x-forwarded-for"))}`, 10, 15 * 60 * 1000))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    const email = cleanEmail(body?.email);
    if (!username) return c.json({ error: "Username must be 3 to 32 letters, numbers, dots, or dashes." }, 400);
    if (password.length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    if (body?.email && !email) return c.json({ error: "Email is not valid." }, 400);
    if (await deps.store.findUserByUsername(username)) return c.json({ error: "That username is taken." }, 409);
    if (email && process.env.REQUIRE_EMAIL_VERIFICATION === "true" && !mailConfigured()) {
      return c.json({ error: "Email is not configured." }, 503);
    }
    const user = await deps.store.createUser({
      username,
      passwordHash: await hashPassword(password),
      displayName: username,
      email,
      googleSub: null,
      emailVerified: false,
    });
    await seedGroq(deps.store, user.workspaceId).catch(() => undefined);
    if (email && mailConfigured()) {
      const token = await deps.store.createEmailVerification(user.userId);
      await sendMail(email, "Verify your LoopAI email", `Open ${deps.webOrigin}/login?verify=${token}`);
    }
    if (email && process.env.REQUIRE_EMAIL_VERIFICATION === "true") {
      return c.json({ username: user.username, displayName: user.displayName, pending: "verify" }, 202);
    }
    return sessionResponse(c, deps, user.userId, user);
  });

  app.post("/v1/auth/login", async (c) => {
    if (!(await allow(`login:${clientIp(c.req.header("x-forwarded-for"))}`, 10, 15 * 60 * 1000))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    const user = username ? await deps.store.findUserByUsername(username) : null;
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ error: "Wrong username or password." }, 401);
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === "true" && user.email && !user.emailVerified) {
      return c.json({ error: "Verify your email before signing in." }, 403);
    }
    return sessionResponse(c, deps, user.userId, user);
  });

  app.post("/v1/auth/logout", async (c) => {
    const token = readCookie(c.req.header("cookie"), COOKIE);
    if (token) await deps.store.deleteSession(hashKey(token));
    c.header("set-cookie", cookieFor("", deps.publicUrl, 0));
    return c.json({ ok: true });
  });

  app.get("/v1/auth/me", async (c) => {
    const user = await userFromCookie(c.req.header("cookie"), deps.store);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ username: user.username, displayName: user.displayName, role: user.role, email: user.email, emailVerified: user.emailVerified });
  });

  app.post("/v1/auth/forgot", async (c) => {
    if (!mailConfigured()) return c.json({ error: "Email is not configured." }, 503);
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    const user = username ? await deps.store.findUserByUsername(username) : null;
    if (user?.email) {
      const token = await deps.store.createPasswordReset(user.userId);
      await sendMail(user.email, "Reset your LoopAI password", `Open ${deps.webOrigin}/login?reset=${token}`);
    }
    return c.json({ message: RESET_NOTE });
  });

  app.post("/v1/auth/reset", async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    const userId = token ? await deps.store.takePasswordReset(hashKey(token)) : null;
    if (!userId) return c.json({ error: "That reset link has expired." }, 400);
    await deps.store.setPassword(userId, await hashPassword(password));
    return c.json({ ok: true });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const ok = token ? await deps.store.takeEmailVerification(hashKey(token)) : false;
    if (!ok) return c.json({ error: "That verification link has expired." }, 400);
    return c.json({ ok: true });
  });

  app.get("/v1/workspaces", async (c) => {
    const user = await userFromCookie(c.req.header("cookie"), deps.store);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ workspaces: await deps.store.listMemberships(user.userId), active: user.workspaceId });
  });

  app.post("/v1/workspace/switch", async (c) => {
    const token = readCookie(c.req.header("cookie"), COOKIE);
    const user = await userFromCookie(c.req.header("cookie"), deps.store);
    if (!token || !user) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json().catch(() => null);
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
    const switched = await deps.store.setSessionWorkspace(hashKey(token), workspaceId);
    if (!switched) return c.json({ error: "You are not a member of that workspace." }, 403);
    return c.json({ ok: true });
  });

  app.post("/v1/workspace/invites", async (c) => {
    const user = await userFromCookie(c.req.header("cookie"), deps.store);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (user.role !== "owner") return c.json({ error: "Only an owner can invite." }, 403);
    const body = await c.req.json().catch(() => null);
    const username = cleanUsername(body?.username);
    if (!username) return c.json({ error: "Username must be 3 to 32 letters, numbers, dots, or dashes." }, 400);
    const invited = await deps.store.inviteMember(user.workspaceId, username);
    if (!invited.ok) return c.json({ error: invited.error }, 400);
    return c.json(invited);
  });

  app.get("/v1/auth/google", async (c) => {
    if (!googleReady()) return c.json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add the login redirect URL in the Google app." }, 400);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    await deps.store.insertOAuthState({
      state,
      workspaceId: null,
      toolkitSlug: "google-login",
      codeVerifierEncrypted: await deps.store.encrypt(null, { verifier }),
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
      const decoded = await deps.store.decrypt(saved.workspaceId, saved.codeVerifierEncrypted);
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
          emailVerified: true,
        });
        await seedGroq(deps.store, user.workspaceId).catch(() => undefined);
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
    c.header("set-cookie", cookieFor(session.rawToken, deps.publicUrl, 1209600));
    return c.json({ username: user.username, displayName: user.displayName, role: user.role });
  });
}

export async function userFromCookie(header: string | undefined, store: Store) {
  const token = readCookie(header, COOKIE);
  if (!token) return null;
  return store.findSession(hashKey(token));
}

function cookieFor(token: string, publicUrl: string, maxAge: number): string {
  const secure = publicUrl.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function sessionResponse(c: { header: (name: string, value: string) => void; json: (body: unknown, status?: number) => Response }, deps: AuthDeps, userId: string, user: { username: string; displayName: string; role: string }) {
  const session = await deps.store.createSession(userId);
  c.header("set-cookie", cookieFor(session.rawToken, deps.publicUrl, 1209600));
  return c.json({ username: user.username, displayName: user.displayName, role: user.role });
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
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
