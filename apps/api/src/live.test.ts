import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { masterKeyFromBase64 } from "@loopai/vault";
import { toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { loadEnv } from "./load-env";
import { createMemoryStore } from "./store";
import { withSession } from "./with-session";

loadEnv(fileURLToPath(new URL("../.env", import.meta.url)));

const key = process.env.GROQ_API_KEY ?? "";

describe.skipIf(key.length < 8)("live Groq", () => {
  test("the saved model answers and that reply downloads as a pdf", async () => {
    const store = createMemoryStore(masterKeyFromBase64(randomBytes(32).toString("base64")));
    const app = await withSession(createApp({
      store,
      toolkits,
      publicUrl: "http://localhost:8787",
      webOrigin: "http://localhost:5173",
    }));
    const llm = await (await app.request("/v1/llm-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "groq", model: "openai/gpt-oss-20b", apiKey: key }),
    })).json();
    const chat = await app.request("/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmConnectionId: llm.id, message: "Reply with exactly the word pong." }),
    });
    const reply = await chat.json();
    expect(chat.status, JSON.stringify(reply)).toBe(200);
    expect(String(reply.reply).toLowerCase()).toContain("pong");
    expect(JSON.stringify(reply)).not.toContain(key);

    const pdf = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "pdf", title: "Chat", text: reply.reply }),
    });
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
  });

  test("job search returns public listings", async () => {
    const store = createMemoryStore(masterKeyFromBase64(randomBytes(32).toString("base64")));
    const app = await withSession(createApp({
      store,
      toolkits,
      publicUrl: "http://localhost:8787",
      webOrigin: "http://localhost:5173",
    }));
    const jobs = await app.request("/v1/tools/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "jobs", action: "search", arguments: { role: "engineer" } }),
    });
    const body = await jobs.json();
    expect(jobs.status, JSON.stringify(body)).toBe(200);
    expect(body.result.jobs.length).toBeGreaterThan(0);
    expect(body.result.jobs[0].url).toMatch(/^https?:\/\//);

    const excel = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "xlsx", executionId: body.id }),
    });
    const sheet = new Uint8Array(await excel.arrayBuffer());
    expect(sheet[0]).toBe(0x50);
  });
});
