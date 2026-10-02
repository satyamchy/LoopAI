import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { decryptJson, encryptJson, masterKeyFromBase64, newDataKey, unwrapKey, wrapKey } from "./crypto";

describe("vault", () => {
  test("round-trips a token and keeps it out of the ciphertext", () => {
    const master = randomBytes(32);
    const dataKey = newDataKey();
    const wrapped = wrapKey(dataKey, master);
    const token = "super-secret-access-token";
    const encrypted = encryptJson({ access_token: token }, unwrapKey(wrapped, master));
    expect(encrypted).not.toContain(token);
    expect(decryptJson(encrypted, dataKey)).toEqual({ access_token: token });
  });

  test("rejects a different master key", () => {
    const wrapped = wrapKey(newDataKey(), randomBytes(32));
    expect(() => unwrapKey(wrapped, randomBytes(32))).toThrow();
  });

  test("requires a 32-byte master key", () => {
    expect(() => masterKeyFromBase64(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
