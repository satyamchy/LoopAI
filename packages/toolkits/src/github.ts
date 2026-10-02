import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** GitHub. The token request must ask for JSON or GitHub returns a form body. */
export const github: Toolkit = {
  slug: "github",
  displayName: "GitHub",
  description: "List repositories on the connected account.",
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
  ],
};
