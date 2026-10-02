import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Telegram bot. Connect with the token from BotFather.
 * The token is placed in the request URL and must never appear in an error or a result.
 */
export const telegram: Toolkit = {
  slug: "telegram",
  displayName: "Telegram",
  description: "Read updates and send a message with a bot token.",
  authType: "api_key",
  credentialFields: [{ key: "botToken", label: "Bot token" }],
  actions: [
    defineAction({
      slug: "get_me",
      description: "Read the bot username. Does not return the bot token.",
      risk: "read",
      input: z.object({}),
      async run(_args, token) {
        const data = await telegramJson(token!, "getMe");
        const result = data.result as { username?: string; first_name?: string } | undefined;
        return { username: result?.username ?? null, name: result?.first_name ?? null };
      },
    }),
    defineAction({
      slug: "get_updates",
      description: "Read the latest text messages sent to the bot.",
      risk: "read",
      input: z.object({ limit: z.number().int().min(1).max(10).optional() }),
      async run(args, token) {
        const data = await telegramJson(token!, `getUpdates?limit=${args.limit ?? 5}`);
        const updates = Array.isArray(data.result) ? data.result : [];
        return {
          messages: updates.map((update) => {
            const message = (update as { message?: { text?: string; chat?: { id?: number } } }).message;
            return { chatId: message?.chat?.id ?? null, text: message?.text ?? null };
          }),
        };
      },
    }),
    defineAction({
      slug: "send_message",
      description: "Send a text message to a chat id.",
      risk: "write",
      input: z.object({ chatId: z.string().min(1), text: z.string().min(1).max(4000) }),
      async run(args, token) {
        const data = await telegramJson(token!, "sendMessage", { chat_id: args.chatId, text: args.text });
        const result = data.result as { message_id?: number } | undefined;
        return { messageId: result?.message_id ?? null };
      },
    }),
  ],
};

async function telegramJson(token: string, method: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Telegram could not be reached.");
  }
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  const json = (await response.json()) as Record<string, unknown>;
  if (json.ok === false) throw new Error("Telegram rejected the request.");
  return json;
}
