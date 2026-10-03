import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** Slack. Bot token from OAuth v2. Add a write action the same way as Gmail send_email. */
export const slack: Toolkit = {
  slug: "slack",
  displayName: "Slack",
  description: "List channels and post a message.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read", "chat:write"],
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
    defineAction({
      slug: "post_message",
      description: "Post a plain-text message to a channel id from list_channels.",
      risk: "write",
      confirm: true,
      input: z.object({ channel: z.string().min(1).max(80), text: z.string().min(1).max(4000) }),
      async run(args, token) {
        const data = await bearerJson("https://slack.com/api/chat.postMessage", token!, {
          method: "POST",
          body: JSON.stringify({ channel: args.channel, text: args.text }),
        });
        if (data.ok === false) throw new Error("Slack rejected the message.");
        return { channel: args.channel, ts: typeof data.ts === "string" ? data.ts : null };
      },
    }),
  ],
};
