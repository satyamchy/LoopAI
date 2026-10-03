import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/** Notion internal integration. The token is a bearer header and is not returned. */
export const notion: Toolkit = {
  slug: "notion",
  displayName: "Notion",
  description: "Search pages and create a page under a parent.",
  authType: "api_key",
  credentialFields: [{ key: "secret", label: "Integration token" }],
  actions: [
    defineAction({
      slug: "search",
      description: "Search pages the integration can see. Returns id and title.",
      risk: "read",
      input: z.object({ query: z.string().min(1).max(200) }),
      async run(args, token) {
        const data = await notionJson("/search", token!, { query: args.query, page_size: 10 });
        const results = Array.isArray(data.results) ? data.results : [];
        return {
          pages: results.slice(0, 10).map((item) => {
            const row = item as { id?: string; properties?: { title?: { title?: { plain_text?: string }[] } } };
            const title = row.properties?.title?.title?.[0]?.plain_text ?? "";
            return { id: row.id ?? null, title };
          }),
        };
      },
    }),
    defineAction({
      slug: "create_page",
      description: "Create a page under a parent page id.",
      risk: "write",
      confirm: true,
      input: z.object({ parentId: z.string().min(8).max(80), title: z.string().min(1).max(200) }),
      async run(args, token) {
        const data = await notionJson("/pages", token!, {
          parent: { page_id: args.parentId },
          properties: { title: { title: [{ text: { content: args.title } }] } },
        });
        return { id: typeof data.id === "string" ? data.id : null };
      },
    }),
  ],
};

async function notionJson(path: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "notion-version": "2022-06-28",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Upstream api.notion.com returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}
