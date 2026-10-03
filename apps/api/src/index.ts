import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { masterKeyFromBase64 } from "@loopai/vault";
import { listCards, toolkits } from "@loopai/toolkits";
import { existsSync } from "node:fs";
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

const webDist = new URL("../../web/dist", import.meta.url);
const webRoot = decodeURIComponent(webDist.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const app = createApp({
  store,
  toolkits,
  publicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:8787",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  webDist: existsSync(webRoot) ? webRoot : null,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`LoopAI API listening on ${port}`);
  void logConnections();
});

async function logConnections(): Promise<void> {
  if (!databaseUrl) {
    console.log("database: memory");
  } else {
    const host = databaseHost(databaseUrl);
    try {
      await store.ping();
      console.log(`database: connected ${host}`);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "failed";
      console.log(`database: unreachable ${host} ${message}`);
    }
  }
  console.log(process.env.VAULT_MASTER_KEY ? "vault: master key set" : "vault: ephemeral key");
  console.log(process.env.REDIS_URL ? "redis: configured" : "redis: not configured");
  console.log(process.env.GROQ_API_KEY ? "model: groq saved when a workspace is created" : "model: groq key not set");
  try {
    const moved = await store.repairSharedVaults();
    if (moved > 0) console.log(`workspace: moved ${moved} members onto their own vault`);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "failed";
    console.log(`workspace: split failed ${message}`);
  }
  console.log(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "google login: ready" : "google login: off");
  for (const card of listCards(toolkits)) {
    const state = !card.implemented ? "planned" : card.configured ? "ready" : `needs ${card.setupEnv ?? "setup"}`;
    console.log(`app ${card.slug}: ${card.authType} ${state}`);
  }
}

function databaseHost(url: string): string {
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).host;
  } catch {
    return "unparsed";
  }
}
