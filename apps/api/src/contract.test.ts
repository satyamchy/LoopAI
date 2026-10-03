import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { masterKeyFromBase64 } from "@loopai/vault";
import { toolkits } from "@loopai/toolkits";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { providerBaseUrl, runToolLoop } from "./run-tool-loop";
import { withSession } from "./with-session";

const master = masterKeyFromBase64(randomBytes(32).toString("base64"));

async function testApp() {
  const store = createMemoryStore(master);
  const raw = createApp({
    store,
    toolkits,
    publicUrl: "https://api.example.com",
    webOrigin: "https://app.example.com",
  });
  const app = await withSession(raw);
  return { app, store, raw };
}

describe("auth contract", () => {
  test("a missing session is rejected and a session lists connections", async () => {
    const store = createMemoryStore(master);
    const raw = createApp({ store, toolkits, publicUrl: "https://api.example.com", webOrigin: "https://app.example.com" });
    const denied = await raw.request("/v1/connections");
    expect(denied.status).toBe(401);
    const wrong = await raw.request("/v1/connections", { headers: { authorization: "Bearer lai_not-a-real-key" } });
    expect(wrong.status).toBe(401);

    const app = await withSession(raw);
    const open = await app.request("/v1/connections");
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ connections: [] });
  });

  test("health does not check the database", async () => {
    const { app } = await testApp();
    const health = await app.request("/v1/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe("oauth callback", () => {
  test("a refused login redirects without copying the provider error into the url", async () => {
    const { app } = await testApp();
    const leaked = "provider-token-should-not-appear";
    const response = await app.request(`/v1/oauth/callback?error=access_denied&error_description=${leaked}`, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("https://app.example.com/connect/apps")).toBe(true);
    expect(location).toContain("error=oauth");
    expect(location).not.toContain(leaked);
    expect(location).not.toContain("access_denied");
  });
});

describe("tool execute contract", () => {
  test("invalid arguments return field names and not the value", async () => {
    const { app } = await testApp();
    const secret = "echo-secret-value";
    const account = await (
      await app.request("/v1/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolkit: "echo", secret }),
      })
    ).json();
    const payload = "x".repeat(600);
    const executed = await app.request("/v1/tools/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolkit: "echo",
        action: "echo",
        arguments: { message: payload },
        connectedAccountId: account.id,
      }),
    });
    const body = await executed.json();
    expect(executed.status).toBe(400);
    expect(body.error).toBe("Invalid arguments");
    expect(body.fields).toEqual(["message"]);
    expect(JSON.stringify(body)).not.toContain(payload);
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  test("an oauth app cannot be saved as an api key", async () => {
    const { app } = await testApp();
    const response = await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "gmail", secret: "not-a-gmail-token" }),
    });
    expect(response.status).toBe(400);
  });

  test("an unknown toolkit is not executed", async () => {
    const { app } = await testApp();
    const response = await app.request("/v1/tools/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: "not-a-toolkit", action: "search", arguments: {} }),
    });
    expect(response.status).toBe(404);
  });
});

describe("chat loop limits", () => {
  test("the tool loop stops after six model rounds", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: `call_${calls}`, type: "function", function: { name: "news__latest", arguments: "{}" } }],
            },
          },
        ],
      });
    };
    const result = await runToolLoop({
      endpoint: "https://example.test/v1/chat/completions",
      apiKey: "llm-key-value",
      model: "test",
      history: [{ role: "user", content: "keep going" }],
      tools: [{ name: "news__latest", description: "news", parameters: { type: "object", properties: {} } }],
      callTool: async () => ({ ok: true }),
      fetchImpl,
      secrets: ["llm-key-value"],
    });
    expect(calls).toBe(6);
    expect(result.text).toBe("I could not finish that with the connected tools.");
    expect(result.toolsUsed).toHaveLength(6);
  });

  test("a custom base url is used as given, with one trailing slash removed", () => {
    expect(providerBaseUrl("openai", null)).toBe("https://api.openai.com/v1");
    expect(providerBaseUrl("compatible", "https://models.internal/v1/")).toBe("https://models.internal/v1");
    expect(() => providerBaseUrl("compatible", null)).toThrow(/base URL/);
  });
});
