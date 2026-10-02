import { describe, expect, test } from "vitest";
import { redact, secretStrings } from "./redact";

describe("redact", () => {
  test("strips token fields and known secret strings", () => {
    const secret = "gmail-access-token-value";
    const credentials = { access_token: secret, expires_at: "2026-01-01T00:00:00.000Z" };
    expect(secretStrings(credentials)).toEqual([secret]);
    const cleaned = redact(
      { snippet: `see ${secret}`, access_token: secret, nested: { refresh_token: "refresh-token-value" } },
      secretStrings(credentials),
    );
    expect(JSON.stringify(cleaned)).not.toContain(secret);
    expect(JSON.stringify(cleaned)).not.toContain("refresh-token-value");
  });
});
