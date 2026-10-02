import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Apply the schema to Supabase.
 * Use DIRECT_URL (port 5432). The API runtime uses the pooler in DATABASE_URL.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("Set DIRECT_URL to the Supabase direct connection string.");
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  ssl: url.includes("localhost") ? undefined : "require",
});

const migration = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8");
await sql.unsafe(migration);
await sql.end();
console.log("Applied 0001_init.sql");
