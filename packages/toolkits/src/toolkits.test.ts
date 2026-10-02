import { describe, expect, test, vi } from "vitest";
import { executeToolkit } from "./execute";
import { gmail } from "./gmail";
import { hindiRender } from "./hindi-render";
import { parseRss } from "./news";
import { authorizeUrl } from "./oauth";
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
