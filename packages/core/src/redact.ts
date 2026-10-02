const SECRET_KEYS = /token|secret|password|authorization|api[_-]?key|refresh|credential|verifier/i;

/** Pull secret field values out of a credential blob so results can be scrubbed. */
export function secretStrings(value: unknown): string[] {
  const found: string[] = [];
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    for (const [key, item] of Object.entries(current)) {
      if (typeof item === "string" && item.length >= 8 && SECRET_KEYS.test(key)) found.push(item);
      else walk(item);
    }
  };
  walk(value);
  return found;
}

/**
 * Remove known secrets and any field whose name looks like a credential.
 * Call this on every tool result and audit row before it is stored or returned.
 */
export function redact(value: unknown, secrets: string[]): unknown {
  const needles = secrets.filter((secret) => secret.length >= 8);
  const walk = (current: unknown): unknown => {
    if (typeof current === "string") {
      return needles.reduce((text, secret) => text.split(secret).join("[redacted]"), current);
    }
    if (Array.isArray(current)) return current.map(walk);
    if (current && typeof current === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(current)) {
        out[key] = SECRET_KEYS.test(key) ? "[redacted]" : walk(item);
      }
      return out;
    }
    return current;
  };
  return walk(value);
}
