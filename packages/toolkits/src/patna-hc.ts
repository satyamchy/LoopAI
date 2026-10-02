import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Patna High Court public lookup.
 * The case-status form often shows a captcha. This tool never solves one.
 * If the page does not return a case list, call paste_order with the text the user copied.
 * Only values that appear in the pasted text are returned.
 */
const SEARCH_PAGE = "https://patnahighcourt.gov.in/";

const emptyCase = {
  blocked: true,
  status: null,
  nextDate: null,
  dateMentioned: null,
  orderText: null,
  caseNumber: null,
  sourceUrl: SEARCH_PAGE,
  sourceText: null as string | null,
};

export const patnaHc: Toolkit = {
  slug: "patna-hc",
  displayName: "Patna High Court",
  description: "Look up a case by party name, or read a pasted order.",
  authType: "none",
  actions: [
    defineAction({
      slug: "search_by_party",
      description: "Search the public Patna High Court site by party name. Returns blocked when the site does not provide a case list.",
      risk: "read",
      input: z.object({ partyName: z.string().min(2).max(200) }),
      async run(args) {
        try {
          const response = await fetch(SEARCH_PAGE, { signal: AbortSignal.timeout(8_000) });
          const html = await response.text();
          const blocked = !response.ok || /captcha/i.test(html) || !html.toLowerCase().includes(args.partyName.toLowerCase());
          if (blocked) {
            return { ...emptyCase, blocked: true, partyName: args.partyName, message: "The court site did not return a case list. Paste the order text." };
          }
          return {
            blocked: false,
            partyName: args.partyName,
            status: null,
            nextDate: null,
            dateMentioned: null,
            orderText: null,
            caseNumber: null,
            sourceUrl: SEARCH_PAGE,
            sourceText: null,
            message: "The party name appeared on the public page, but no order text was parsed. Paste the order.",
          };
        } catch {
          return { ...emptyCase, partyName: args.partyName, message: "The court site did not respond. Paste the order text." };
        }
      },
    }),
    defineAction({
      slug: "paste_order",
      description: "Read an order the user pasted. Extracts only a case number and a date that are literally in the text.",
      risk: "read",
      input: z.object({ text: z.string().min(1).max(20_000) }),
      async run(args) {
        const caseNumber = args.text.match(/\b[A-Z]{1,8}\.?\s*(?:No\.?|Number)?\s*\d{1,6}\s*\/\s*\d{4}\b/i)?.[0] ?? null;
        const dateMentioned = args.text.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/)?.[0] ?? null;
        return {
          blocked: false,
          status: null,
          nextDate: null,
          dateMentioned,
          orderText: args.text,
          caseNumber,
          sourceUrl: null,
          sourceText: args.text,
        };
      },
    }),
  ],
};
