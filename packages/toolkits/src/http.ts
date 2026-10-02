/** Authenticated JSON call. Errors name the host and status, not the response body. */
export async function bearerJson(url: string, token: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("user-agent", "loopai");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Upstream ${new URL(url).host} returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}
