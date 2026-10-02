import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Perplexity Sonar. Connect with an API key from the Perplexity console.
 * The key is a bearer token and must not appear in the result.
 */
export const perplexity: Toolkit = {
  slug: "perplexity",
  displayName: "Perplexity",
  description: "Ask a question and get an answer with citations.",
  authType: "api_key",
  credentialFields: [{ key: "apiKey", label: "API key" }],
  actions: [
    defineAction({
      slug: "ask",
      description: "Ask Perplexity Sonar a question. Returns the answer text and citation URLs.",
      risk: "read",
      input: z.object({
        query: z.string().min(1).max(2000),
        model: z.enum(["sonar", "sonar-pro"]).optional(),
      }),
      async run(args, token) {
        if (!token) throw new Error("Connect Perplexity again. API key is missing.");
        let response: Response;
        try {
          response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: args.model ?? "sonar",
              messages: [{ role: "user", content: args.query }],
            }),
            signal: AbortSignal.timeout(30_000),
          });
        } catch {
          throw new Error("Perplexity could not be reached.");
        }
        if (!response.ok) throw new Error(`Perplexity returned ${response.status}`);
        const json = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          citations?: unknown;
        };
        const citations = Array.isArray(json.citations) ? json.citations.filter((item): item is string => typeof item === "string") : [];
        return { answer: json.choices?.[0]?.message?.content ?? "", citations };
      },
    }),
  ],
};
