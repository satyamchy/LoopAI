import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** LinkedIn OpenID. Returns the public profile fields, not the access token. */
export const linkedin: Toolkit = {
  slug: "linkedin",
  displayName: "LinkedIn",
  description: "Read the connected member's basic profile.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "email"],
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
  },
  actions: [
    defineAction({
      slug: "get_profile",
      description: "Read the member name and email from the OpenID userinfo endpoint.",
      risk: "read",
      input: z.object({}),
      async run(_args, token) {
        const data = await bearerJson("https://api.linkedin.com/v2/userinfo", token!);
        return { name: data.name ?? null, email: data.email ?? null };
      },
    }),
  ],
};
