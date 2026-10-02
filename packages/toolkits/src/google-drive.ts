import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { googleOAuth } from "./oauth";

/** Google Drive. Uses the same Google client as Gmail, with Drive scopes only. */
export const googleDrive: Toolkit = {
  slug: "google-drive",
  displayName: "Google Drive",
  description: "List recent Drive files.",
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
  ],
};
