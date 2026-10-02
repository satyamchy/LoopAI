import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { masterKeyFromBase64 } from "@loopai/vault";
import { toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { createSupabaseStore } from "./db-store";
import { loadEnv } from "./load-env";
import { createMemoryStore } from "./store";

loadEnv(envPath());

function envPath(): string {
  const path = decodeURIComponent(new URL("../.env", import.meta.url).pathname);
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

const databaseUrl = process.env.DATABASE_URL;
let masterKey: Buffer;
if (process.env.VAULT_MASTER_KEY) {
  masterKey = masterKeyFromBase64(process.env.VAULT_MASTER_KEY);
} else if (databaseUrl) {
  throw new Error('Set VAULT_MASTER_KEY. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
} else {
  masterKey = randomBytes(32);
  console.warn("VAULT_MASTER_KEY is not set. Using an ephemeral key with the memory store.");
}

const store = databaseUrl ? createSupabaseStore(databaseUrl, masterKey) : createMemoryStore(masterKey);
if (!databaseUrl) console.warn("DATABASE_URL is not set. Connections stay in memory. Point DATABASE_URL at Supabase to persist them.");

const app = createApp({
  store,
  toolkits,
  publicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:8787",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`LoopAI API listening on ${port}`);
});
