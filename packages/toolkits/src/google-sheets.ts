import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { googleOAuth } from "./oauth";

/** Read one range. Uses the same Google client as Gmail, with the Sheets scope. */
export const googleSheets: Toolkit = {
  slug: "google-sheets",
  displayName: "Google Sheets",
  description: "Read and update values in a spreadsheet the account can open.",
  authType: "oauth2",
  oauth: googleOAuth(["https://www.googleapis.com/auth/spreadsheets"]),
  actions: [
    defineAction({
      slug: "read_values",
      description: "Read one range. Returns the grid of cell values, not the token.",
      risk: "read",
      input: z.object({
        spreadsheetId: z.string().min(8).max(200),
        range: z.string().min(1).max(80),
      }),
      async run(args, token) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}`;
        const data = await bearerJson(url, token!);
        const values = Array.isArray(data.values) ? data.values : [];
        return { range: typeof data.range === "string" ? data.range : args.range, values: values.slice(0, 500) };
      },
    }),
    defineAction({
      slug: "update_values",
      description: "Write a grid of values into one range. Existing cells in that range are replaced.",
      risk: "write",
      confirm: true,
      input: z.object({
        spreadsheetId: z.string().min(8).max(200),
        range: z.string().min(1).max(80),
        values: z.array(z.array(z.string().max(2000))).min(1).max(100),
      }),
      async run(args, token) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}?valueInputOption=USER_ENTERED`;
        const data = await bearerJson(url, token!, {
          method: "PUT",
          body: JSON.stringify({ range: args.range, values: args.values }),
        });
        return { updatedRange: typeof data.updatedRange === "string" ? data.updatedRange : args.range };
      },
    }),
  ],
};
