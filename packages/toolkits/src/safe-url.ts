import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const METADATA = new Set(["169.254.169.254", "metadata.google.internal", "fd00:ec2::254"]);

export type UrlPolicy = { allowLocalhost: boolean };

/**
 * Refuse metadata hosts, private addresses, and redirects onto those hosts.
 * Custom MCP may pass allowLocalhost. Review must not.
 */
export async function assertPublicUrl(raw: string, policy: UrlPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("That URL is not allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA.has(host)) throw new Error("That site is not allowed.");
  if (isLocal(host)) {
    if (!policy.allowLocalhost) throw new Error("That site is not allowed.");
    return url;
  }
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some((address) => isBlocked(address))) {
    throw new Error("That site is not allowed.");
  }
  return url;
}

/** Follow redirects by hand so each next host is checked. */
export async function fetchChecked(raw: string, init: RequestInit, policy: UrlPolicy): Promise<Response> {
  let current = await assertPublicUrl(raw, policy);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("That site is not allowed.");
    current = await assertPublicUrl(new URL(location, current).toString(), policy);
  }
  throw new Error("That site is not allowed.");
}

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function resolve(host: string): Promise<string[]> {
  try {
    const rows = await lookup(host, { all: true, verbatim: true });
    return rows.map((row) => row.address);
  } catch {
    return [];
  }
}

function isBlocked(address: string): boolean {
  const ip = address.toLowerCase();
  if (METADATA.has(ip) || isLocal(ip)) return true;
  if (ip.includes(":")) {
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("ff")) return true;
    return false;
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
