import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Fresh headlines from a public RSS feed.
 * Titles come only from the feed. An empty feed returns no stories.
 */
const FEEDS = [
  { id: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { id: "business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
];

export const news: Toolkit = {
  slug: "news",
  displayName: "News",
  description: "Read fresh public headlines.",
  authType: "none",
  actions: [
    defineAction({
      slug: "latest",
      description: "Read the latest headlines for world, technology, or business.",
      risk: "read",
      input: z.object({ topic: z.enum(["world", "technology", "business"]).optional(), limit: z.number().int().min(1).max(10).optional() }),
      async run(args) {
        const feed = FEEDS.find((item) => item.id === (args.topic ?? "world")) ?? FEEDS[0];
        const response = await fetch(feed.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`News feed returned ${response.status}`);
        return { topic: feed.id, stories: parseRss(await response.text(), args.limit ?? 8) };
      },
    }),
  ],
};

/** Pull title and link pairs out of an RSS document. Nothing is added that was not in the XML. */
export function parseRss(xml: string, limit: number): { title: string; link: string }[] {
  const stories: { title: string; link: string }[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    if (stories.length >= limit) break;
    const block = match[1];
    const title = decodeXml(block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] ?? "").trim();
    const link = decodeXml(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    if (title) stories.push({ title, link });
  }
  return stories;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
