import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** GitHub. The token request must ask for JSON or GitHub returns a form body. */
export const github: Toolkit = {
  slug: "github",
  displayName: "GitHub",
  description: "List repositories and open an issue.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["read:user", "repo"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    tokenHeaders: { accept: "application/json" },
    profile: { url: "https://api.github.com/user", labelField: "login" },
  },
  actions: [
    defineAction({
      slug: "list_repos",
      description: "List repositories. Returns name and whether it is private.",
      risk: "read",
      input: z.object({ perPage: z.number().int().min(1).max(20).optional() }),
      async run(args, token) {
        const data = await bearerJson(`https://api.github.com/user/repos?per_page=${args.perPage ?? 5}&sort=updated`, token!);
        const repos = Array.isArray(data) ? data : [];
        return { repos: repos.map((repo) => ({ name: (repo as { name?: string }).name, private: (repo as { private?: boolean }).private ?? false })) };
      },
    }),
    defineAction({
      slug: "create_issue",
      description: "Open an issue on owner/repo. Returns the issue number and url.",
      risk: "write",
      confirm: true,
      input: z.object({
        owner: z.string().min(1).max(80),
        repo: z.string().min(1).max(120),
        title: z.string().min(1).max(200),
        body: z.string().max(8000).optional(),
      }),
      async run(args, token) {
        const data = await bearerJson(`https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues`, token!, {
          method: "POST",
          body: JSON.stringify({ title: args.title, body: args.body ?? "" }),
        });
        return {
          number: typeof data.number === "number" ? data.number : null,
          url: typeof data.html_url === "string" ? data.html_url : null,
        };
      },
    }),
  ],
};
