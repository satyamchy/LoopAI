import { connect } from "node:net";

const buckets = new Map<string, number[]>();

/** True when the caller is still inside the window. Redis is used when REDIS_URL is set. */
export async function allow(key: string, limit: number, windowMs: number): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      return await redisAllow(url, key, limit, windowMs);
    } catch {
      // A down Redis must not take the API down. The memory window still applies.
    }
  }
  const now = Date.now();
  const rows = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (rows.length >= limit) {
    buckets.set(key, rows);
    return false;
  }
  rows.push(now);
  buckets.set(key, rows);
  return true;
}

export function clientIp(header: string | undefined): string {
  const forwarded = header?.split(",")[0]?.trim();
  return forwarded || "local";
}

async function redisAllow(url: string, key: string, limit: number, windowMs: number): Promise<boolean> {
  const count = await redisCommand(url, ["INCR", `rl:${key}`]);
  if (count === 1) await redisCommand(url, ["PEXPIRE", `rl:${key}`, String(windowMs)]);
  return count <= limit;
}

function redisCommand(rawUrl: string, args: string[]): Promise<number> {
  const url = new URL(rawUrl);
  const port = Number(url.port || 6379);
  const payload = encode(args);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port });
    const chunks: Buffer[] = [];
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(1000, () => fail(new Error("Redis timed out")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.startsWith(":")) return;
      socket.end();
      resolve(Number(text.slice(1)));
    });
    socket.on("connect", () => {
      const secret = decodeURIComponent(url.password);
      if (secret) socket.write(encode(["AUTH", secret]));
      socket.write(payload);
    });
  });
}

function encode(args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`;
}
