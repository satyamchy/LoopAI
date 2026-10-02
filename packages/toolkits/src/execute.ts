import type { Toolkit } from "@loopai/core";

/**
 * The only way a tool runs. Routes, chat, and MCP all call this.
 * API-key tools do not receive their secret. OAuth tools receive the access token.
 */
export async function executeToolkit(
  toolkit: Toolkit,
  action: string,
  args: unknown,
  credentials: Record<string, unknown>,
): Promise<unknown> {
  const found = toolkit.actions.find((item) => item.slug === action);
  if (!found) throw new Error(`Unknown action ${toolkit.slug}.${action}`);

  if (toolkit.authType === "api_key") {
    const fields = toolkit.credentialFields ?? [{ key: "secret", label: "Secret" }];
    for (const field of fields) {
      const value = credentials[field.key];
      if (typeof value !== "string" || value.length < 8) {
        throw new Error(`Connect ${toolkit.displayName} again. ${field.label} is missing.`);
      }
    }
    // Echo stores a secret only to prove it stays in the vault, so its action does not receive it.
    const token = toolkit.credentialFields ? String(credentials[toolkit.credentialFields[0].key]) : null;
    return found.run(args, token, credentials);
  }

  if (toolkit.authType === "oauth2") {
    const token = credentials.access_token;
    if (typeof token !== "string" || !token) throw new Error("Reconnect this app.");
    return found.run(args, token);
  }

  return found.run(args, null);
}
