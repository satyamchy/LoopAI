import { describe, expect, test, vi } from "vitest";
import { customMcp } from "./custom-mcp";
import { executeToolkit } from "./execute";
import { gmail } from "./gmail";
import { perplexity } from "./perplexity";
import { supabase } from "./supabase";
import { hindiRender } from "./hindi-render";
import { parseRss } from "./news";
import { authorizeUrl, exchangeCode } from "./oauth";
import { googleSheets } from "./google-sheets";
import { twitter } from "./twitter";
import { canva } from "./canva";
import { profile } from "./profile";
import { jobs } from "./jobs";
import { review } from "./review";
import { patnaHc } from "./patna-hc";
import { telegram } from "./telegram";

describe("gmail", () => {
  test("authorize url carries the challenge and not the verifier or secret", () => {
    const url = authorizeUrl(gmail.oauth!, {
      clientId: "cid",
      redirectUri: "http://localhost/cb",
      state: "state",
      codeVerifier: "verifier-value-that-must-stay-off-the-url",
    });
    expect(url).toContain("client_id=cid");
    expect(url).toContain("code_challenge=");
    expect(url).not.toContain("verifier-value-that-must-stay-off-the-url");
    expect(url).not.toContain("SECRET");
  });

  test("list_messages does not return the access token", async () => {
    const token = "gmail-token-value";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/messages?")) return Response.json({ messages: [{ id: "m1" }] });
        return Response.json({
          id: "m1",
          snippet: "Hello",
          payload: { headers: [{ name: "Subject", value: "Hi" }, { name: "From", value: "a@b.c" }] },
        });
      }),
    );
    const result = await executeToolkit(gmail, "list_messages", {}, { access_token: token });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result).toMatchObject({ messages: [{ subject: "Hi", from: "a@b.c" }] });
    vi.unstubAllGlobals();
  });
});

describe("telegram and news", () => {
  test("a telegram failure does not include the bot token", async () => {
    const token = "123456:telegram-secret-token";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(executeToolkit(telegram, "get_me", {}, { botToken: token })).rejects.toThrow("Telegram returned 401");
    vi.unstubAllGlobals();
  });

  test("news returns only titles that are in the feed", () => {
    const stories = parseRss("<rss><item><title>Market opens</title><link>https://example.com/a</link></item></rss>", 5);
    expect(stories).toEqual([{ title: "Market opens", link: "https://example.com/a" }]);
    expect(parseRss("<rss></rss>", 5)).toEqual([]);
  });
});

describe("patna and hindi", () => {
  test("a captcha page does not become a case", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>captcha</html>", { status: 200 })));
    const result = await executeToolkit(patnaHc, "search_by_party", { partyName: "Kumar" }, {});
    expect(result).toMatchObject({ blocked: true, status: null, nextDate: null, caseNumber: null });
    vi.unstubAllGlobals();
  });

  test("paste_order returns only literals from the text", async () => {
    const text = "Order dated 02/10/2026 in CR No. 12/2024";
    const result = (await executeToolkit(patnaHc, "paste_order", { text }, {})) as { dateMentioned: string; caseNumber: string; nextDate: null };
    expect(result.dateMentioned).toBe("02/10/2026");
    expect(result.caseNumber).toContain("12/2024");
    expect(result.nextDate).toBeNull();
    const empty = await executeToolkit(patnaHc, "paste_order", { text: "no dates here" }, {});
    expect(empty).toMatchObject({ dateMentioned: null, caseNumber: null });
  });

  test("hindi drops a date that is not in the source text", async () => {
    const result = (await executeToolkit(
      hindiRender,
      "case",
      { sourceText: "Pending", status: "Pending", nextDate: "01/01/2099", orderText: "invented order" },
      {},
    )) as { hindi: string };
    expect(result.hindi).toContain("Pending");
    expect(result.hindi).not.toContain("2099");
    expect(result.hindi).not.toContain("invented order");
    expect(result.hindi).toContain("साइट पर नहीं मिला");
  });
});

describe("perplexity, supabase, and custom mcp", () => {
  test("perplexity returns the answer and not the api key", async () => {
    const key = "pplx-secret-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "A fact" } }], citations: ["https://example.com"] })));
    const result = await executeToolkit(perplexity, "ask", { query: "What is a pooler?" }, { apiKey: key });
    expect(result).toEqual({ answer: "A fact", citations: ["https://example.com"] });
    expect(JSON.stringify(result)).not.toContain(key);
    vi.unstubAllGlobals();
  });

  test("supabase refuses the LoopAI project and a non-supabase host", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres.projref:secret@aws-0.pooler.supabase.com:6543/postgres";
    try {
      await expect(
        executeToolkit(supabase, "select_rows", { table: "items" }, { projectUrl: "https://projref.supabase.co", apiKey: "service-role-key" }),
      ).rejects.toThrow("different Supabase project");
      await expect(
        executeToolkit(supabase, "select_rows", { table: "items" }, { projectUrl: "https://example.com", apiKey: "service-role-key" }),
      ).rejects.toThrow("project URL");
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  test("custom mcp lists tools and rejects the metadata host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") return Response.json({ result: { protocolVersion: "2025-03-26" } }, { headers: { "mcp-session-id": "s1" } });
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        const headers = new Headers(init?.headers);
        expect(headers.get("mcp-session-id")).toBe("s1");
        return Response.json({ result: { tools: [{ name: "search", description: "Find" }] } });
      }),
    );
    const result = await executeToolkit(customMcp, "list_tools", {}, { serverUrl: "http://127.0.0.1:3333/mcp" });
    expect(result).toEqual({ tools: [{ name: "search", description: "Find" }] });
    vi.unstubAllGlobals();
    await expect(executeToolkit(customMcp, "list_tools", {}, { serverUrl: "http://169.254.169.254/latest" })).rejects.toThrow("not allowed");
  });
});

describe("new connectors", () => {
  test("sheets read does not return the access token", async () => {
    const token = "sheet-token-value";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(String(url)).toContain("/spreadsheets/sheet-id-1/values/");
      expect(String(url)).not.toContain(token);
      return Response.json({ range: "Sheet1!A1", values: [["a"]] });
    }));
    const result = await executeToolkit(googleSheets, "read_values", { spreadsheetId: "sheet-id-1", range: "Sheet1!A1" }, { access_token: token });
    expect(result).toEqual({ range: "Sheet1!A1", values: [["a"]] });
    expect(JSON.stringify(result)).not.toContain(token);
    vi.unstubAllGlobals();
  });

  test("twitter and canva authorize urls carry the challenge and not the secret", () => {
    const twitterUrl = authorizeUrl(twitter.oauth!, {
      clientId: "cid",
      redirectUri: "http://localhost/cb",
      state: "state",
      codeVerifier: "verifier-value-that-must-stay-off-the-url",
    });
    expect(twitterUrl).toContain("code_challenge=");
    expect(twitterUrl).toContain("users.read");
    expect(twitterUrl).not.toContain("verifier-value-that-must-stay-off-the-url");
    const canvaUrl = authorizeUrl(canva.oauth!, {
      clientId: "cid",
      redirectUri: "http://127.0.0.1:8787/v1/oauth/callback",
      state: "state",
      codeVerifier: "verifier-value-that-must-stay-off-the-url",
    });
    expect(canvaUrl).toContain("code_challenge_method=s256");
    expect(canvaUrl).not.toContain("verifier-value-that-must-stay-off-the-url");
  });

  test("canva token uses basic auth and leaves the secret out of the body", async () => {
    process.env.CANVA_CLIENT_ID = "canva-id";
    process.env.CANVA_CLIENT_SECRET = "canva-secret-value";
    let authorization = "";
    let body = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        body = String(init?.body);
        return Response.json({ access_token: "tok", expires_in: 100 });
      }
      return Response.json({ user: { display_name: "Ada" } });
    }));
    const tokens = await exchangeCode(canva.oauth!, {
      code: "abc",
      redirectUri: "http://127.0.0.1:8787/v1/oauth/callback",
      codeVerifier: "verifier-value-that-must-stay-off-the-url",
    });
    expect(tokens.label).toBe("Ada");
    expect(authorization.startsWith("Basic ")).toBe(true);
    expect(body).not.toContain("canva-secret-value");
    delete process.env.CANVA_CLIENT_ID;
    delete process.env.CANVA_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  test("profile send does not return the gmail token", async () => {
    const token = "gmail-token-value";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "m1" })));
    const result = await executeToolkit(profile, "send_intro", { to: "hr@example.com" }, {
      fullName: "Satyam",
      email: "me@example.com",
      phone: "9999999999",
      about: "I build software.",
      subject: "Intro",
      body: "Hello there.",
      gmailAccessToken: token,
    });
    expect(result).toEqual({ id: "m1", to: "hr@example.com" });
    expect(JSON.stringify(result)).not.toContain(token);
    vi.unstubAllGlobals();
  });

  test("job search returns public listings and not the raw host error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("remotive")) {
        return Response.json({ jobs: [{ title: "Backend Engineer", company_name: "Acme", candidate_required_location: "Remote", url: "https://example.com/job" }] });
      }
      return Response.json({ data: [] });
    }));
    const result = await executeToolkit(jobs, "search", { role: "backend" }, {});
    expect(result).toEqual({ jobs: [{ title: "Backend Engineer", company: "Acme", location: "Remote", url: "https://example.com/job" }] });
    vi.unstubAllGlobals();
  });

  test("review returns GitHub and the page, and refuses a metadata host", async () => {
    const token = "linkedin-token-value";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("api.github.com/users/octocat/repos")) {
        return Response.json([{ name: "hello", description: "A repo", language: "TypeScript", stargazers_count: 3 }]);
      }
      if (target.includes("api.github.com/users/octocat")) {
        return Response.json({ login: "octocat", name: "Octo", bio: "Builder", public_repos: 4 });
      }
      if (target.includes("userinfo")) return Response.json({ name: "Ada", email: "ada@example.com" });
      return new Response("<html><title>Site</title><body>I build tools.</body></html>", { status: 200 });
    }));
    const result = await executeToolkit(review, "analyze", {
      goal: "backend role",
      github: "octocat",
      website: "https://example.com",
      linkedinSummary: "Open to work.",
    }, { profileName: "Satyam", profileAbout: "I build software.", profileEmail: "me@example.com", linkedinAccessToken: token });
    expect(result).toMatchObject({
      goal: "backend role",
      profile: { name: "Satyam", about: "I build software.", email: "me@example.com" },
      github: { login: "octocat", repos: [{ name: "hello", language: "TypeScript", stars: 3 }] },
      website: { url: "https://example.com/", title: "Site" },
      linkedin: { name: "Ada", summary: "Open to work." },
    });
    expect(JSON.stringify(result)).toContain("I build tools.");
    expect(JSON.stringify(result)).not.toContain(token);
    await expect(executeToolkit(review, "analyze", { goal: "backend role", website: "http://169.254.169.254/latest" }, {})).rejects.toThrow("That site is not allowed.");
    await expect(executeToolkit(review, "analyze", { goal: "backend role", website: "http://127.0.0.1/secret" }, {})).rejects.toThrow("That site is not allowed.");
    vi.stubGlobal("fetch", vi.fn(async () => Response.redirect("http://169.254.169.254/latest", 302)));
    await expect(executeToolkit(review, "analyze", { goal: "backend role", website: "https://example.com/go" }, {})).rejects.toThrow("That site is not allowed.");
    vi.unstubAllGlobals();
  });
});
