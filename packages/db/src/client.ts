import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Supabase pooler connections must not use prepared statements. */
export function createDb(url: string) {
  const sql = postgres(url, {
    prepare: false,
    max: 3,
    ssl: url.includes("localhost") ? undefined : "require",
  });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
