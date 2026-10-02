import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { masterKeyFromBase64 } from "@loopai/vault";
import { listCards, toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { modelProviders } from "./run-tool-loop";
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
  void logConnections();
});

/** Save the local Groq key into the vault once. The key is not logged. */
async function ensureGroqModel(): Promise<void> {
  const key = process.env.GROQ_API_KEY;
  const groq = modelProviders.find((item) => item.id === "groq");
  if (!key || key.length < 8 || !groq?.defaultModel) return;
  const workspace = await store.ensureWorkspace();
  const saved = await store.listLlms(workspace.id);
  if (saved.some((item) => item.provider === "groq" && item.model === groq.defaultModel)) {
    console.log(`model: groq ${groq.defaultModel} ready`);
    return;
  }
  await store.insertLlm({
    workspaceId: workspace.id,
    provider: "groq",
    model: groq.defaultModel,
    baseUrl: null,
    encryptedApiKey: await store.encrypt({ apiKey: key }),
  });
  console.log(`model: groq ${groq.defaultModel} saved`);
}

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
  try {
    await ensureGroqModel();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "failed";
    console.log(`model: groq not saved ${message}`);
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
