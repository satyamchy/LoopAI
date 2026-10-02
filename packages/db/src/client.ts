import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Local Postgres has no TLS. Hosted Supabase does. */
export function sslFor(url: string): "require" | undefined {
  return /localhost|127\.0\.0\.1/.test(url) ? undefined : "require";
}

/** Pooler connections must not use prepared statements. */
export function createDb(url: string) {
  const sql = postgres(url, {
    prepare: false,
    max: 3,
    ssl: sslFor(url),
  });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
