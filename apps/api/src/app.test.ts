import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { masterKeyFromBase64 } from "@loopai/vault";
import { echo, toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { withSession } from "./with-session";

const master = masterKeyFromBase64(randomBytes(32).toString("base64"));

async function testApp(fetchImpl?: typeof fetch) {
  const store = createMemoryStore(master);
  const app = await withSession(createApp({
    store,
    toolkits,
    publicUrl: "http://localhost:8787",
    webOrigin: "http://localhost:5173",
    fetchImpl,
  }));
  return { app, store };
}

describe("execute", () => {
  test("stores an echo secret and does not return it", async () => {
    const { app, store } = await testApp();
    const secret = "echo-secret-value";
    const connected = await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "echo", secret }),
    });
    const account = await connected.json();
    const row = await store.getAccount(account.id);
    expect(row?.encryptedCredentials).not.toContain(secret);
    expect(await store.decrypt(row!.encryptedCredentials)).toEqual({ secret });

    const executed = await app.request("/v1/tools/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "echo", action: "echo", arguments: { message: "hello" }, connectedAccountId: account.id }),
    });
    const body = await executed.json();
    expect(executed.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.result).toEqual({ message: "hello", connected: true });

    const listed = await app.request("/v1/connections");
    expect(JSON.stringify(await listed.json())).not.toContain(secret);
  });

  test("replays an idempotency key without running the tool again", async () => {
    let calls = 0;
    const counting = {
      ...echo,
      actions: echo.actions.map((action) => ({
        ...action,
        run: async (args: unknown, token: string | null) => {
          calls += 1;
          return action.run(args, token);
        },
      })),
    };
    const store = createMemoryStore(master);
    const app = await withSession(createApp({ store, toolkits: [counting], publicUrl: "http://localhost:8787", webOrigin: "http://localhost:5173" }));
    const connected = await (await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "echo", secret: "echo-secret-value" }),
    })).json();
    const send = () =>
      app.request("/v1/tools/execute", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "same" },
        body: JSON.stringify({ toolkit: "echo", action: "echo", arguments: { message: "once" }, connectedAccountId: connected.id }),
      });
    await send();
    await send();
    expect(calls).toBe(1);
  });
});

describe("chat", () => {
  test("does not send the vault secret or the model key in the prompt body", async () => {
    const secret = "echo-secret-value";
    const llmKey = "llm-key-abcdefghijklmnopqrstuvwxyz";
    const bodies: string[] = [];
    let step = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      const header = new Headers(init?.headers).get("authorization") ?? "";
      expect(header).toContain(llmKey);
      expect(body).not.toContain(llmKey);
      step += 1;
      if (step === 1) {
        const name = JSON.parse(body).tools[0].function.name as string;
        return Response.json({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify({ message: "hi" }) } }] } }],
        });
      }
      return Response.json({ choices: [{ message: { role: "assistant", content: "done" } }] });
    };
    const { app } = await testApp(fetchImpl);
    const account = await (await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "echo", secret }),
    })).json();
    const llm = await (await app.request("/v1/llm-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "gpt-test", apiKey: llmKey }),
    })).json();
    const chat = await app.request("/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmConnectionId: llm.id, message: "say hi", connectedAccountId: account.id }),
    });
    expect(chat.status).toBe(200);
    expect(bodies.join("\n")).not.toContain(secret);
    expect(JSON.stringify(await chat.json())).not.toContain(secret);
  });
});

describe("agent keys", () => {
  test("shows the raw key once and rejects MCP without it", async () => {
    const { app } = await testApp();
    const created = await (await app.request("/v1/agent-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cursor" }) })).json();
    expect(created.key).toMatch(/^lai_/);
    const listed = await (await app.request("/v1/agent-keys")).json();
    expect(JSON.stringify(listed)).not.toContain(created.key);
    const denied = await app.request("/mcp", { method: "POST" });
    expect(denied.status).toBe(401);

    const initialized = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.0.1" } },
      }),
    });
    const text = await initialized.text();
    expect(initialized.status).toBeLessThan(400);
    expect(text).toContain("loopai");
  });
});

describe("chats", () => {
  test("deletes a chat and its messages", async () => {
    const { app, store } = await testApp();
    const workspace = await store.ensureWorkspace();
    const created = await store.createConversation(workspace.id, "Old chat");
    await store.insertMessage(created.id, "user", "hello");
    const removed = await app.request(`/v1/conversations/${created.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const listed = await (await app.request("/v1/conversations")).json();
    expect(listed.conversations).toEqual([]);
    const missing = await app.request(`/v1/conversations/${created.id}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });
});

describe("docs", () => {
  test("serves the OpenAPI document", async () => {
    const { app } = await testApp();
    const spec = await app.request("/openapi.json");
    expect(spec.status).toBe(200);
    const body = await spec.json();
    expect(body.paths["/v1/chat"].post).toBeTruthy();
    expect(body.paths["/v1/connections"].post).toBeTruthy();
    const page = await app.request("/docs");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("swagger");
  });
});
