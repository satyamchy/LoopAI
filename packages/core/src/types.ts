/**
 * Shared types. Tool modules and the API both use these.
 * The browser receives ToolkitCard only. It never receives `run` or tokens.
 */

export type AuthType = "none" | "api_key" | "oauth2";
export type Risk = "read" | "write";
export type AccountScope = "user" | "workspace";

/** OAuth settings for one app. Client secret is an env var name, never a value. */
export type OAuthConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthParams?: Record<string, string>;
  /** Some providers want a JSON token body. The default is a form body. */
  tokenRequest?: "form" | "json";
  /** Send the client secret as HTTP Basic instead of a form field. */
  tokenAuth?: "basic";
  /** When set, this replaces the API public URL on the OAuth redirect. */
  redirectUri?: string;
  tokenHeaders?: Record<string, string>;
  /** Optional call after connect to label the account, usually an email. */
  profile?: { url: string; labelField: string };
  /** Read a public label from the token response. Do not return tokens from this. */
  labelFromToken?: (json: Record<string, unknown>) => string | null;
};

/**
 * One action inside a toolkit.
 * `run` receives a bearer token for OAuth apps. API-key apps pass null so the
 * secret cannot be copied into the result by accident.
 */
export type CredentialField = { key: string; label: string; optional?: boolean; secret?: boolean; long?: boolean };

export type ToolkitAction = {
  slug: string;
  description: string;
  risk: Risk;
  /** External writes wait for a person to confirm. Notes do not. */
  confirm?: boolean;
  parameters: Record<string, unknown>;
  /** Zod schema for MCP. Chat uses `parameters`. */
  schema: unknown;
  /**
   * `token` is the OAuth access token or the first API-key field.
   * `credentials` holds the decrypted account. Do not copy either into the return value.
   */
  run: (args: unknown, token: string | null, credentials?: Record<string, unknown>) => Promise<unknown>;
};

/** Add a new app by exporting one of these and registering it. */
export type Toolkit = {
  slug: string;
  displayName: string;
  description: string;
  authType: AuthType;
  oauth?: OAuthConfig;
  /** API-key apps. Echo uses `secret`. Telegram uses `botToken`. */
  credentialFields?: CredentialField[];
  actions: ToolkitAction[];
};

/** What the Connect Apps grid is allowed to see. */
export type ToolkitCard = {
  slug: string;
  displayName: string;
  description: string;
  authType: AuthType;
  implemented: boolean;
  configured: boolean;
  setupEnv: string | null;
  credentialFields: CredentialField[];
  actions: { slug: string; description: string; risk: Risk }[];
};
