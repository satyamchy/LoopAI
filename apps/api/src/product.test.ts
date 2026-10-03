import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { masterKeyFromBase64 } from "@loopai/vault";
import { toolkits } from "@loopai/toolkits";
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

async function execute(app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> }, body: unknown) {
  return app.request("/v1/tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("product checks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("groq offers openai/gpt-oss-20b", async () => {
    const { app } = await testApp();
    const body = await (await app.request("/v1/providers")).json();
    const groq = body.providers.find((item: { id: string }) => item.id === "groq");
    expect(groq).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-20b" });
  });

  test("intro email says to connect Gmail when that account is missing", async () => {
    const { app } = await testApp();
    const profile = await (await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolkit: "profile",
        credentials: {
          fullName: "Satyam",
          email: "me@example.com",
          phone: "9999999999",
          about: "I build software.",
          subject: "Intro",
          body: "Hello there.",
        },
      }),
    })).json();
    const sent = await execute(app, {
      toolkit: "profile",
      action: "send_intro",
      arguments: { to: "hr@example.com" },
      connectedAccountId: profile.id,
    });
    expect(sent.status).toBe(400);
    expect(await sent.json()).toMatchObject({ error: "Connect Gmail before sending an intro email." });
  });

  test("intro email posts one message and does not return the Gmail token", async () => {
    const token = "gmail-token-value";
    const calls: { url: string; body: string; auth: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        auth: new Headers(init?.headers).get("authorization") ?? "",
      });
      return Response.json({ id: "m1" });
    }));
    const { app, store } = await testApp();
    const workspace = await store.ensureWorkspace();
    await store.insertAccount({
      workspaceId: workspace.id,
      toolkitSlug: "gmail",
      scope: "user",
      externalLabel: "Gmail",
      expiresAt: null,
      encryptedCredentials: await store.encrypt(workspace.id, { access_token: token }),
    });
    const profile = await (await app.request("/v1/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolkit: "profile",
        credentials: {
          fullName: "Satyam",
          email: "me@example.com",
          about: "I build software.",
          subject: "Intro",
          body: "Hello there.",
        },
      }),
    })).json();
    const pending = await execute(app, {
      toolkit: "profile",
      action: "send_intro",
      arguments: { to: "hr@example.com" },
      connectedAccountId: profile.id,
    });
    const waiting = await pending.json();
    expect(pending.status).toBe(202);
    expect(calls).toHaveLength(0);
    const sent = await app.request("/v1/chat/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: waiting.approvalId, accept: true }),
    });
    const body = await sent.json();
    expect(sent.status).toBe(200);
    expect(body.result).toEqual({ id: "m1", to: "hr@example.com" });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(calls[0].auth).toBe(`Bearer ${token}`);
    const raw = JSON.parse(calls[0].body).raw as string;
    const message = Buffer.from(raw, "base64url").toString("utf8");
    expect(message).toContain("To: hr@example.com");
    expect(message).toContain("Subject: Intro");
    expect(message).toContain("Hello there.");
    expect(message).toContain("Satyam");
  });

  test("notes, a chapter, and a job table download as excel and pdf", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("remotive")) {
        return Response.json({ jobs: [{ title: "Backend Engineer", company_name: "Acme", candidate_required_location: "Remote", url: "https://example.com/job" }] });
      }
      return Response.json({ data: [] });
    }));
    const { app } = await testApp();
    const saved = await (await execute(app, { toolkit: "notes", action: "save", arguments: { title: "Reminder", body: "Call the office." } })).json();
    expect(saved.status).toBe("succeeded");
    const found = await (await execute(app, { toolkit: "notes", action: "search", arguments: { query: "office" } })).json();
    expect(found.result.notes[0].title).toBe("Reminder");

    const chapter = await (await execute(app, { toolkit: "manuscript", action: "add_chapter", arguments: { title: "Chapter 1", body: "The first page." } })).json();
    expect(chapter.result.title).toBe("Chapter 1");
    const listed = await (await execute(app, { toolkit: "manuscript", action: "list_chapters", arguments: {} })).json();
    expect(listed.result.chapters).toHaveLength(1);

    const jobs = await (await execute(app, { toolkit: "jobs", action: "search", arguments: { role: "backend" } })).json();
    expect(jobs.result.jobs[0].title).toBe("Backend Engineer");

    const excel = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "xlsx", executionId: jobs.id }),
    });
    expect(excel.status).toBe(200);
    expect(excel.headers.get("content-type")).toContain("spreadsheet");
    const sheet = new Uint8Array(await excel.arrayBuffer());
    expect(sheet[0]).toBe(0x50);
    expect(sheet[1]).toBe(0x4b);

    const pdf = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "pdf", title: "Chat", text: "Findings go here." }),
    });
    expect(pdf.status).toBe(200);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(bytes[0]).toBe(0x25);

    const word = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "docx", title: "Chat", text: "Findings go here." }),
    });
    const doc = new Uint8Array(await word.arrayBuffer());
    expect(doc[0]).toBe(0x50);
    expect(doc[1]).toBe(0x4b);
  });

  test("a chat reply can be downloaded and the model key stays out of the file", async () => {
    const llmKey = "llm-key-abcdefghijklmnopqrstuvwxyz";
    const fetchImpl: typeof fetch = async () => Response.json({
      choices: [{ message: { role: "assistant", content: "The office note is saved." } }],
    });
    const { app } = await testApp(fetchImpl);
    const llm = await (await app.request("/v1/llm-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "groq", model: "openai/gpt-oss-20b", apiKey: llmKey }),
    })).json();
    const chat = await app.request("/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmConnectionId: llm.id, message: "Save a note" }),
    });
    const reply = await chat.json();
    expect(chat.status).toBe(200);
    expect(reply.reply).toBe("The office note is saved.");
    const pdf = await app.request("/v1/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "pdf", title: "Chat", text: reply.reply }),
    });
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain(llmKey);
  });
});
