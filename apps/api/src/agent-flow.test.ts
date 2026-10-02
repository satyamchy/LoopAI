import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { masterKeyFromBase64 } from "@loopai/vault";
import { toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { withSession } from "./with-session";

const master = masterKeyFromBase64(randomBytes(32).toString("base64"));

function toolCall(name: string, args: unknown) {
  return Response.json({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
  });
}

function text(content: string) {
  return Response.json({ choices: [{ message: { role: "assistant", content } }] });
}

async function chat(message: string, fetchImpl: typeof fetch) {
  const store = createMemoryStore(master);
  const app = await withSession(createApp({
    store,
    toolkits,
    publicUrl: "http://localhost:8787",
    webOrigin: "http://localhost:5173",
    fetchImpl,
  }));
  const llm = await (await app.request("/v1/llm-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "groq", model: "openai/gpt-oss-20b", apiKey: "llm-key-abcdefghijklmnopqrstuvwxyz" }),
  })).json();
  const response = await app.request("/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ llmConnectionId: llm.id, message }),
  });
  return { app, store, response, body: await response.json() };
}

describe("agent tool calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a job prompt calls jobs search", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("remotive")) {
        return Response.json({ jobs: [{ title: "Backend Engineer", company_name: "Acme", candidate_required_location: "Remote", url: "https://example.com/job" }] });
      }
      return Response.json({ data: [] });
    }));
    const { response, body } = await chat("Find backend jobs", async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const called = [...payload.messages].reverse().find((item: { role: string }) => item.role === "tool");
      if (called) return text(String(called.content));
      const name = payload.tools.map((item: { function: { name: string } }) => item.function.name).find((item: string) => item === "jobs__search");
      return toolCall(name, { role: "backend" });
    });
    expect(response.status).toBe(200);
    expect(body.tools).toContain("jobs__search");
    expect(body.reply).toContain("Backend Engineer");
  });

  test("a note prompt calls notes save", async () => {
    const { response, body } = await chat("Save a note", async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const called = [...payload.messages].reverse().find((item: { role: string }) => item.role === "tool");
      if (called) return text(String(called.content));
      const name = payload.tools.map((item: { function: { name: string } }) => item.function.name).find((item: string) => item === "notes__save");
      return toolCall(name, { title: "Reminder", body: "Call the office." });
    });
    expect(response.status).toBe(200);
    expect(body.tools).toContain("notes__save");
    expect(body.reply).toContain("Reminder");
  });

  test("a plain prompt does not call a tool", async () => {
    const { response, body } = await chat("Say hello", async () => text("Hello."));
    expect(response.status).toBe(200);
    expect(body.tools).toEqual([]);
    expect(body.reply).toBe("Hello.");
  });

  test("an intro email without Gmail returns the connect error", async () => {
    const store = createMemoryStore(master);
    const fetchImpl: typeof fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const called = [...payload.messages].reverse().find((item: { role: string }) => item.role === "tool");
      if (called) return text(String(called.content));
      const name = payload.tools.map((item: { function: { name: string } }) => item.function.name).find((item: string) => String(item).includes("send_intro"));
      return toolCall(name, { to: "hr@example.com" });
    };
    const app = await withSession(createApp({
      store,
      toolkits,
      publicUrl: "http://localhost:8787",
      webOrigin: "http://localhost:5173",
      fetchImpl,
    }));
    await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolkit: "profile",
        credentials: { fullName: "Satyam", email: "me@example.com", about: "I build software.", subject: "Intro", body: "Hello there." },
      }),
    });
    const llm = await (await app.request("/v1/llm-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "groq", model: "openai/gpt-oss-20b", apiKey: "llm-key-abcdefghijklmnopqrstuvwxyz" }),
    })).json();
    const response = await app.request("/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmConnectionId: llm.id, message: "Email an intro to hr@example.com" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.tools.some((name: string) => name.includes("send_intro"))).toBe(true);
    expect(body.reply).toContain("Connect Gmail before sending an intro email.");
  });
});
