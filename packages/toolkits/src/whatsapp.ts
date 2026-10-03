import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * WhatsApp Cloud API. Connect with a permanent token and the phone number id
 * from the Meta app. Personal WhatsApp sessions are not supported.
 * The token is sent as a bearer header and must not be returned.
 */
export const whatsapp: Toolkit = {
  slug: "whatsapp",
  displayName: "WhatsApp",
  description: "Send a text message through the WhatsApp Cloud API.",
  authType: "api_key",
  credentialFields: [
    { key: "accessToken", label: "Access token" },
    { key: "phoneNumberId", label: "Phone number ID" },
  ],
  actions: [
    defineAction({
      slug: "send_text",
      description: "Send a text message to a phone number in international format.",
      risk: "write",
      confirm: true,
      input: z.object({ to: z.string().min(8).max(20), body: z.string().min(1).max(4000) }),
      async run(args, token, credentials) {
        const phoneNumberId = credentials?.phoneNumberId;
        if (typeof phoneNumberId !== "string") throw new Error("Connect WhatsApp again. Phone number ID is missing.");
        let response: Response;
        try {
          response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: args.to,
              type: "text",
              text: { body: args.body },
            }),
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          throw new Error("WhatsApp could not be reached.");
        }
        if (!response.ok) throw new Error(`WhatsApp returned ${response.status}`);
        const json = (await response.json()) as { messages?: { id?: string }[] };
        return { id: json.messages?.[0]?.id ?? null };
      },
    }),
  ],
};
