import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** X (Twitter) OAuth. A confidential client must send the secret as HTTP Basic. */
export const twitter: Toolkit = {
  slug: "twitter",
  displayName: "Twitter",
  description: "Read the connected X account.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "users.read", "offline.access"],
    clientIdEnv: "TWITTER_CLIENT_ID",
    clientSecretEnv: "TWITTER_CLIENT_SECRET",
    tokenAuth: "basic",
    profile: { url: "https://api.twitter.com/2/users/me", labelField: "data.username" },
  },
  actions: [
    defineAction({
      slug: "get_me",
      description: "Read the connected account's name and username.",
      risk: "read",
      input: z.object({}),
      async run(_args, token) {
        const data = await bearerJson("https://api.twitter.com/2/users/me?user.fields=name,username", token!);
        const user = data.data as { name?: unknown; username?: unknown } | undefined;
        return {
          name: typeof user?.name === "string" ? user.name : null,
          username: typeof user?.username === "string" ? user.username : null,
        };
      },
    }),
  ],
};
