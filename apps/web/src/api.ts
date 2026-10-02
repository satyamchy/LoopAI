export type ToolkitCard = {
  slug: string;
  displayName: string;
  description: string;
  authType: "none" | "api_key" | "oauth2";
  implemented: boolean;
  configured: boolean;
  setupEnv: string | null;
  credentialFields: { key: string; label: string }[];
  actions: { slug: string; description: string; risk?: string }[];
};

export type Connection = {
  id: string;
  toolkitSlug: string;
  scope: "user" | "workspace";
  status: string;
  externalLabel: string | null;
  createdAt: string;
};

export type LlmConnection = { id: string; provider: string; model: string; baseUrl: string | null };

export type ProviderOption = { id: string; label: string; baseUrl: string; defaultModel: string };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}
