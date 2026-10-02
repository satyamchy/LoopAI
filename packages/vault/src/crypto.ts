import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption.
 * The master key lives in VAULT_MASTER_KEY and never in the database.
 * Each workspace has a data key, wrapped by the master key, in workspace_keys.
 * Credential blobs are encrypted with the workspace data key.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function masterKeyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("VAULT_MASTER_KEY must be 32 bytes of base64.");
  return key;
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

/** Wrap a workspace data key with the master key. Store only the result. */
export function wrapKey(dataKey: Buffer, masterKey: Buffer): string {
  return seal(dataKey, masterKey);
}

/** Unwrap a workspace data key. Call this only inside the API process. */
export function unwrapKey(wrapped: string, masterKey: Buffer): Buffer {
  return open(wrapped, masterKey);
}

/** Encrypt a credential object. The string is ciphertext, not JSON. */
export function encryptJson(value: unknown, dataKey: Buffer): string {
  return seal(Buffer.from(JSON.stringify(value), "utf8"), dataKey);
}

/** Decrypt a credential object. Do not log the result. */
export function decryptJson(payload: string, dataKey: Buffer): unknown {
  return JSON.parse(open(payload, dataKey).toString("utf8"));
}

function seal(plaintext: Buffer, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function open(payload: string, key: Buffer): Buffer {
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length < IV_LENGTH + TAG_LENGTH) throw new Error("Credential payload is invalid.");
  const iv = bytes.subarray(0, IV_LENGTH);
  const tag = bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = bytes.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
