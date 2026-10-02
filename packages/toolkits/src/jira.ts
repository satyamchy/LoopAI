import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** Jira Cloud. The action looks up the site id, then reads recent issues. */
export const jira: Toolkit = {
  slug: "jira",
  displayName: "Jira",
  description: "List recent Jira issues.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:jira-work", "offline_access"],
    clientIdEnv: "JIRA_CLIENT_ID",
    clientSecretEnv: "JIRA_CLIENT_SECRET",
    tokenRequest: "json",
    extraAuthParams: { audience: "api.atlassian.com", prompt: "consent" },
  },
  actions: [
    defineAction({
      slug: "list_issues",
      description: "List recently updated issues. Returns key and summary.",
      risk: "read",
      input: z.object({ maxResults: z.number().int().min(1).max(10).optional() }),
      async run(args, token) {
        const resources = await bearerJson("https://api.atlassian.com/oauth/token/accessible-resources", token!);
        const sites = Array.isArray(resources) ? resources : [];
        const cloudId = (sites[0] as { id?: string } | undefined)?.id;
        if (!cloudId) throw new Error("No Jira site is available on this account.");
        const data = await bearerJson(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?jql=${encodeURIComponent("order by updated DESC")}&maxResults=${args.maxResults ?? 5}&fields=summary`,
          token!,
        );
        const issues = Array.isArray(data.issues) ? data.issues : [];
        return {
          issues: issues.map((issue) => {
            const row = issue as { key?: string; fields?: { summary?: string } };
            return { key: row.key, summary: row.fields?.summary ?? null };
          }),
        };
      },
    }),
  ],
};
