export type ToolkitCard = {
  slug: string;
  displayName: string;
  description: string;
  authType: "none" | "api_key" | "oauth2";
  implemented: boolean;
  configured: boolean;
  setupEnv: string | null;
  credentialFields: { key: string; label: string; optional?: boolean; secret?: boolean; long?: boolean }[];
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
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({ error: "Request failed" }));
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export type SessionUser = { username: string; displayName: string };

export type DownloadRef = { id: string; tool: string; tabular: boolean };

export async function downloadFile(body: { format: "pdf" | "xlsx" | "docx"; title?: string; text?: string; executionId?: string }, filename: string) {
  const response = await fetch("/v1/exports", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failed = await response.json().catch(() => ({ error: "Download failed" }));
    throw new Error(failed.error ?? "Download failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
