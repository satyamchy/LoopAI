import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** X (Twitter) OAuth. A confidential client must send the secret as HTTP Basic. */
export const twitter: Toolkit = {
  slug: "twitter",
  displayName: "Twitter",
  description: "Read the connected X account and post a tweet.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
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
    defineAction({
      slug: "post_tweet",
      description: "Post one tweet. A vendor refusal comes back as a status, not the response body.",
      risk: "write",
      confirm: true,
      input: z.object({ text: z.string().min(1).max(280) }),
      async run(args, token) {
        const data = await bearerJson("https://api.twitter.com/2/tweets", token!, {
          method: "POST",
          body: JSON.stringify({ text: args.text }),
        });
        const tweet = data.data as { id?: unknown } | undefined;
        return { id: typeof tweet?.id === "string" ? tweet.id : null };
      },
    }),
  ],
};
