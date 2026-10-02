import { createHash, randomBytes } from "node:crypto";

/** Hash an agent key before it is stored. The raw key is shown once. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Create a workspace key for MCP and other agents. */
export function newAgentKey(): string {
  return `lai_${randomBytes(32).toString("base64url")}`;
}
