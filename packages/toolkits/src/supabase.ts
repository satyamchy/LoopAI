import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Read rows from a Supabase project through PostgREST.
 * Use a project that is not the LoopAI database. The service role of this
 * project can read password hashes and encrypted credentials.
 */
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const supabase: Toolkit = {
  slug: "supabase",
  displayName: "Supabase",
  description: "Read rows from a Supabase project.",
  authType: "api_key",
  credentialFields: [
    { key: "projectUrl", label: "Project URL", secret: false },
    { key: "apiKey", label: "API key" },
  ],
  actions: [
    defineAction({
      slug: "select_rows",
      description: "Read up to 20 rows from one public table. Returns the rows PostgREST returned.",
      risk: "read",
      input: z.object({
        table: z.string().regex(TABLE),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      async run(args, _token, credentials) {
        const projectUrl = typeof credentials?.projectUrl === "string" ? credentials.projectUrl : "";
        const apiKey = typeof credentials?.apiKey === "string" ? credentials.apiKey : "";
        const origin = supabaseOrigin(projectUrl);
        const limit = args.limit ?? 5;
        const url = `${origin}/rest/v1/${args.table}?select=${encodeURIComponent("*")}&limit=${limit}`;
        let response: Response;
        try {
          response = await fetch(url, {
            headers: { apikey: apiKey, authorization: `Bearer ${apiKey}`, accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          throw new Error("Supabase could not be reached.");
        }
        if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
        const rows = (await response.json()) as unknown;
        return { table: args.table, rows: Array.isArray(rows) ? rows : [] };
      },
    }),
  ],
};

export function supabaseOrigin(projectUrl: string): string {
  let url: URL;
  try {
    url = new URL(projectUrl);
  } catch {
    throw new Error("Use the project URL, https://<ref>.supabase.co.");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || url.username || url.password) {
    throw new Error("Use the project URL, https://<ref>.supabase.co.");
  }
  const ref = loopaiProjectRef();
  if (ref && url.hostname === `${ref}.supabase.co`) {
    throw new Error("Connect a different Supabase project. This one stores LoopAI accounts.");
  }
  return url.origin;
}

function loopaiProjectRef(): string | null {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const pooled = databaseUrl.match(/postgres\.([a-z0-9]+)/);
  const direct = databaseUrl.match(/db\.([a-z0-9]+)\.supabase\.co/);
  return pooled?.[1] ?? direct?.[1] ?? null;
}
