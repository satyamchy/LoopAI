import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** Slack. Bot token from OAuth v2. Add a write action the same way as Gmail send_email. */
export const slack: Toolkit = {
  slug: "slack",
  displayName: "Slack",
  description: "List channels the bot can see.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    labelFromToken: (json) => {
      const team = json.team as { name?: string } | undefined;
      return team?.name ?? null;
    },
  },
  actions: [
    defineAction({
      slug: "list_channels",
      description: "List public channels. Returns id and name.",
      risk: "read",
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      async run(args, token) {
        const data = await bearerJson(`https://slack.com/api/conversations.list?limit=${args.limit ?? 20}`, token!);
        if (data.ok === false) throw new Error(`Slack ${String(data.error ?? "request failed")}`);
        const channels = Array.isArray(data.channels) ? data.channels : [];
        return { channels: channels.map((channel) => ({ id: (channel as { id?: string }).id, name: (channel as { name?: string }).name })) };
      },
    }),
  ],
};
