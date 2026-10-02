import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Hindi rendering for a court result.
 * Every value must already be inside sourceText from patna-hc.
 * A missing fact becomes "साइट पर नहीं मिला". This tool does not paraphrase the order.
 */
const input = z.object({
  sourceText: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  dateMentioned: z.string().nullable().optional(),
  orderText: z.string().nullable().optional(),
  caseNumber: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

export const hindiRender: Toolkit = {
  slug: "hindi-render",
  displayName: "Hindi",
  description: "Turn a court tool result into Hindi lines, quoting only text that was fetched.",
  authType: "none",
  actions: [
    defineAction({
      slug: "case",
      description: "Render case fields in Hindi. Drop any value that is not inside sourceText.",
      risk: "read",
      input,
      async run(args) {
        if (!args.sourceText) {
          return { hindi: "कोर्ट टूल का स्रोत पाठ नहीं मिला।", source: null };
        }
        const quoted = (value?: string | null) => (value && args.sourceText?.includes(value) ? value : null);
        const status = quoted(args.status);
        const nextDate = quoted(args.nextDate);
        const dateMentioned = quoted(args.dateMentioned);
        const orderText = quoted(args.orderText);
        const caseNumber = quoted(args.caseNumber);
        const lines = [
          line("स्थिति", status),
          line("अगली तारीख", nextDate),
          line("आदेश में लिखी तारीख", dateMentioned),
          line("केस नंबर", caseNumber),
          line("आदेश में क्या कहा गया", orderText),
          "अब क्या करना है: साइट पर अगला कदम नहीं लिखा है",
        ];
        return {
          hindi: lines.join("\n"),
          source: { status, nextDate, dateMentioned, orderText, caseNumber, sourceUrl: args.sourceUrl ?? null },
        };
      },
    }),
  ],
};

function line(label: string, value: string | null): string {
  return value ? `${label}: ${value}` : `${label}: साइट पर नहीं मिला`;
}
