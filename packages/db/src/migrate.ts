import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Apply every SQL file in src/migrations, in filename order, once.
 * Use DIRECT_URL (port 5432). The API runtime uses DATABASE_URL.
 * Editing schema.ts does not change Postgres. Add the next SQL file, then run this.
 */
const envFile = fileURLToPath(new URL("../../../apps/api/.env", import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim();
  }
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("Set DIRECT_URL to the Supabase direct connection string.");
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  ssl: url.includes("localhost") ? undefined : "require",
});

const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

await sql.unsafe(`
  create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )
`);

const applied = await sql<{ filename: string }[]>`select filename from schema_migrations`;
const done = new Set(applied.map((row) => row.filename));

for (const file of files) {
  if (done.has(file)) {
    console.log(`Skip ${file}`);
    continue;
  }
  await sql.unsafe(readFileSync(join(dir, file), "utf8"));
  await sql`insert into schema_migrations (filename) values (${file})`;
  console.log(`Applied ${file}`);
}

await sql.end();
