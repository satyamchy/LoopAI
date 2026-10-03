import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { googleOAuth } from "./oauth";

/**
 * Gmail is the OAuth template. Copy the shape, not the URLs.
 * list_messages is a read. send_email is a write. Both use the bearer token
 * and return only message fields.
 */
export const gmail: Toolkit = {
  slug: "gmail",
  displayName: "Gmail",
  description: "Read recent mail and send a plain-text message.",
  authType: "oauth2",
  oauth: googleOAuth([
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
  ]),
  actions: [
    defineAction({
      slug: "list_messages",
      description: "List recent inbox messages. Returns id, from, subject, and snippet.",
      risk: "read",
      input: z.object({ maxResults: z.number().int().min(1).max(10).optional() }),
      async run(args, token) {
        const max = args.maxResults ?? 5;
        const listed = await bearerJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}`,
          token!,
        );
        const ids = Array.isArray(listed.messages) ? listed.messages : [];
        const messages = await Promise.all(
          ids.slice(0, max).map(async (item) => {
            const id = String((item as { id?: string }).id ?? "");
            const message = await bearerJson(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
              token!,
            );
            const headers = headerMap(message);
            return { id, from: headers.From ?? null, subject: headers.Subject ?? null, snippet: message.snippet ?? null };
          }),
        );
        return { messages };
      },
    }),
    defineAction({
      slug: "send_email",
      description: "Send a plain-text email. Does not return the Gmail token.",
      risk: "write",
      confirm: true,
      input: z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000),
      }),
      async run(args, token) {
        const raw = Buffer.from(
          [`To: ${args.to}`, `Subject: ${args.subject}`, "Content-Type: text/plain; charset=utf-8", "", args.body].join("\r\n"),
        ).toString("base64url");
        const sent = await bearerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", token!, {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return { id: sent.id ?? null };
      },
    }),
  ],
};

function headerMap(message: Record<string, unknown>): Record<string, string> {
  const payload = message.payload as { headers?: { name?: string; value?: string }[] } | undefined;
  const out: Record<string, string> = {};
  for (const header of payload?.headers ?? []) {
    if (header.name && header.value) out[header.name] = header.value;
  }
  return out;
}
