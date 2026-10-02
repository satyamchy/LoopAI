import { createHash } from "node:crypto";
import type { OAuthConfig } from "@loopai/core";

/**
 * Shared OAuth helpers. A new OAuth app sets an OAuthConfig on its toolkit.
 * It does not copy this file. The callback route calls exchangeCode.
 */

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_at: string | null;
  label: string | null;
};

export function authorizeUrl(
  oauth: OAuthConfig,
  input: { clientId: string; redirectUri: string; state: string; codeVerifier: string },
): string {
  const url = new URL(oauth.authorizationUrl);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oauth.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", codeChallenge(input.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(oauth.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Exchange the callback code. The returned object is what we encrypt. */
export async function exchangeCode(
  oauth: OAuthConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
): Promise<TokenSet> {
  const clientId = requiredEnv(oauth.clientIdEnv);
  const clientSecret = requiredEnv(oauth.clientSecretEnv);
  const json = await tokenRequest(oauth, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: input.codeVerifier,
  });
  const token = readToken(json);
  const label = oauth.labelFromToken?.(json) ?? (await profileLabel(oauth, token.access_token));
  return { ...token, label };
}

/** Refresh one account. Callers must single-flight this per account id. */
export async function refreshAccessToken(oauth: OAuthConfig, refreshToken: string): Promise<TokenSet> {
  const json = await tokenRequest(oauth, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requiredEnv(oauth.clientIdEnv),
    client_secret: requiredEnv(oauth.clientSecretEnv),
  });
  const token = readToken(json);
  return {
    ...token,
    refresh_token: token.refresh_token ?? refreshToken,
    label: null,
  };
}

export function clientConfigured(oauth: OAuthConfig): boolean {
  return Boolean(process.env[oauth.clientIdEnv] && process.env[oauth.clientSecretEnv]);
}

export function googleOAuth(scopes: string[]): OAuthConfig {
  return {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes,
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    profile: { url: "https://www.googleapis.com/oauth2/v2/userinfo", labelField: "email" },
  };
}

export function microsoftOAuth(scopes: string[]): OAuthConfig {
  return {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", ...scopes],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    extraAuthParams: { prompt: "consent" },
    profile: { url: "https://graph.microsoft.com/v1.0/me", labelField: "userPrincipalName" },
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before connecting this app.`);
  return value;
}

async function tokenRequest(oauth: OAuthConfig, body: Record<string, string>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(oauth.tokenHeaders ?? {}),
  };
  const response =
    oauth.tokenRequest === "json"
      ? await fetch(oauth.tokenUrl, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch(oauth.tokenUrl, {
          method: "POST",
          headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
        });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof json.error === "string" || json.ok === false) {
    throw new Error("The app refused the connection. Check the client id, secret, and redirect URL.");
  }
  return json;
}

function readToken(json: Record<string, unknown>): Omit<TokenSet, "label"> {
  if (typeof json.access_token !== "string") throw new Error("The app did not return an access token.");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
  return {
    access_token: json.access_token,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  };
}

async function profileLabel(oauth: OAuthConfig, token: string): Promise<string | null> {
  if (!oauth.profile) return null;
  const response = await fetch(oauth.profile.url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) return null;
  const json = (await response.json()) as Record<string, unknown>;
  const label = json[oauth.profile.labelField];
  return typeof label === "string" ? label : null;
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
