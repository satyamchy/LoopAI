import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { microsoftOAuth } from "./oauth";

/** Outlook mail through Microsoft Graph. Shares MICROSOFT_CLIENT_ID with Teams. */
export const outlook: Toolkit = {
  slug: "outlook",
  displayName: "Outlook",
  description: "Read recent Outlook mail and send a plain-text message.",
  authType: "oauth2",
  oauth: microsoftOAuth(["Mail.Read", "Mail.Send", "User.Read"]),
  actions: [
    defineAction({
      slug: "list_messages",
      description: "List recent messages. Returns id, subject, from, and received time.",
      risk: "read",
      input: z.object({ top: z.number().int().min(1).max(10).optional() }),
      async run(args, token) {
        const data = await bearerJson(
          `https://graph.microsoft.com/v1.0/me/messages?$top=${args.top ?? 5}&$select=id,subject,from,receivedDateTime`,
          token!,
        );
        const messages = Array.isArray(data.value) ? data.value : [];
        return {
          messages: messages.map((message) => {
            const row = message as { id?: string; subject?: string; receivedDateTime?: string; from?: { emailAddress?: { address?: string } } };
            return { id: row.id, subject: row.subject ?? null, from: row.from?.emailAddress?.address ?? null, received: row.receivedDateTime ?? null };
          }),
        };
      },
    }),
    defineAction({
      slug: "send_mail",
      description: "Send a plain-text email from the connected Outlook account.",
      risk: "write",
      confirm: true,
      input: z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000),
      }),
      async run(args, token) {
        const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            message: {
              subject: args.subject,
              body: { contentType: "Text", content: args.body },
              toRecipients: [{ emailAddress: { address: args.to } }],
            },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Upstream graph.microsoft.com returned ${response.status}`);
        return { to: args.to };
      },
    }),
  ],
};
