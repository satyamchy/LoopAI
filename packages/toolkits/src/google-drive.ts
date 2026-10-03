import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { googleOAuth } from "./oauth";

/** Google Drive. Uses the same Google client as Gmail, with Drive scopes only. */
export const googleDrive: Toolkit = {
  slug: "google-drive",
  displayName: "Google Drive",
  description: "List recent Drive files and read one file.",
  authType: "oauth2",
  oauth: googleOAuth(["https://www.googleapis.com/auth/drive.readonly"]),
  actions: [
    defineAction({
      slug: "list_files",
      description: "List files. Returns id, name, and mime type.",
      risk: "read",
      input: z.object({ pageSize: z.number().int().min(1).max(20).optional() }),
      async run(args, token) {
        const data = await bearerJson(
          `https://www.googleapis.com/drive/v3/files?pageSize=${args.pageSize ?? 10}&fields=files(id,name,mimeType)`,
          token!,
        );
        const files = Array.isArray(data.files) ? data.files : [];
        return { files: files.map((file) => ({ id: (file as { id?: string }).id, name: (file as { name?: string }).name, mimeType: (file as { mimeType?: string }).mimeType })) };
      },
    }),
    defineAction({
      slug: "read_file",
      description: "Read one file as text. Google Docs are exported. Other files are capped.",
      risk: "read",
      input: z.object({ fileId: z.string().min(4).max(200) }),
      async run(args, token) {
        const meta = await bearerJson(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.fileId)}?fields=id,name,mimeType`,
          token!,
        );
        const mime = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const exportMime = mime === "application/vnd.google-apps.document" || mime === "application/vnd.google-apps.spreadsheet" || mime === "application/vnd.google-apps.presentation";
        const url = exportMime
          ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.fileId)}/export?mimeType=text/plain`
          : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.fileId)}?alt=media`;
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`Upstream www.googleapis.com returned ${response.status}`);
        const text = (await response.text()).slice(0, 16_000);
        return { id: meta.id ?? args.fileId, name: meta.name ?? null, mimeType: mime, text };
      },
    }),
  ],
};
