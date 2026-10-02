import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

const CANVA = "https://api.canva.com/rest/v1";

/**
 * Canva Connect. Creates an empty design or imports a manuscript PDF.
 * The API does not type the book into Canva's editor.
 */
export const canva: Toolkit = {
  slug: "canva",
  displayName: "Canva",
  description: "Create a Canva doc or presentation, or import the manuscript as a PDF.",
  authType: "oauth2",
  oauth: {
    authorizationUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: `${CANVA}/oauth/token`,
    scopes: ["design:meta:read", "design:content:read", "design:content:write"],
    clientIdEnv: "CANVA_CLIENT_ID",
    clientSecretEnv: "CANVA_CLIENT_SECRET",
    tokenAuth: "basic",
    redirectUri: "http://127.0.0.1:8787/v1/oauth/callback",
    extraAuthParams: { code_challenge_method: "s256" },
    profile: { url: `${CANVA}/users/me`, labelField: "user.display_name" },
  },
  actions: [
    defineAction({
      slug: "create_design",
      description: "Create an empty Canva doc or presentation and return its edit URL.",
      risk: "write",
      input: z.object({
        title: z.string().min(1).max(120),
        preset: z.enum(["doc", "presentation"]).optional(),
        width: z.number().int().min(40).max(8000).optional(),
        height: z.number().int().min(40).max(8000).optional(),
      }),
      async run(args, token) {
        if ((args.width === undefined) !== (args.height === undefined)) throw new Error("Set both width and height, or neither.");
        if (args.width && args.height && args.width * args.height > 25_000_000) throw new Error("Design is too large.");
        const designType = args.width && args.height
          ? { type: "custom", width: args.width, height: args.height }
          : { type: "preset", name: args.preset ?? "doc" };
        const data = await bearerJson(`${CANVA}/designs`, token!, {
          method: "POST",
          body: JSON.stringify({ design_type: designType, title: args.title }),
        });
        const design = data.design as Record<string, unknown> | undefined;
        return designLink(design);
      },
    }),
    defineAction({
      slug: "import_manuscript",
      description: "Import the saved book chapters into Canva as a PDF design. Returns the edit URL.",
      risk: "write",
      input: z.object({ title: z.string().min(1).max(120).optional() }),
      async run(args, token, credentials) {
        const encoded = credentials?.manuscriptPdfBase64;
        if (typeof encoded !== "string" || encoded.length < 16) throw new Error("Add a chapter before sending the book to Canva.");
        const bytes = Buffer.from(encoded, "base64");
        const title = Buffer.from(args.title ?? "Manuscript", "utf8").toString("base64");
        const started = await fetch(`${CANVA}/imports`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/octet-stream",
            "import-metadata": JSON.stringify({ title_base64: title, mime_type: "application/pdf" }),
          },
          body: bytes,
          signal: AbortSignal.timeout(30_000),
        });
        if (!started.ok) throw new Error(`Canva import returned ${started.status}.`);
        const created = (await started.json()) as { job?: { id?: string } };
        const jobId = created.job?.id;
        if (!jobId) throw new Error("Canva did not start the import.");
        const job = await poll(`${CANVA}/imports/${jobId}`, token!);
        const designs = (job.result as { designs?: Record<string, unknown>[] } | undefined)?.designs;
        return designLink(designs?.[0]);
      },
    }),
    defineAction({
      slug: "export_design",
      description: "Export a Canva design as PDF. The download URL expires after 24 hours.",
      risk: "read",
      input: z.object({ designId: z.string().min(4).max(80) }),
      async run(args, token) {
        const started = await bearerJson(`${CANVA}/exports`, token!, {
          method: "POST",
          body: JSON.stringify({ design_id: args.designId, format: { type: "pdf" } }),
        });
        const jobId = (started.job as { id?: string } | undefined)?.id;
        if (!jobId) throw new Error("Canva did not start the export.");
        const job = await poll(`${CANVA}/exports/${jobId}`, token!);
        const urls = Array.isArray(job.urls) ? job.urls.filter((item): item is string => typeof item === "string") : [];
        return { urls: urls.slice(0, 3) };
      },
    }),
  ],
};

function designLink(design: Record<string, unknown> | undefined): { designId: string | null; editUrl: string | null } {
  const urls = design?.urls as { edit_url?: unknown } | undefined;
  return {
    designId: typeof design?.id === "string" ? design.id : null,
    editUrl: typeof urls?.edit_url === "string" ? urls.edit_url : null,
  };
}

async function poll(url: string, token: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = await bearerJson(url, token);
    const job = (data.job ?? {}) as Record<string, unknown>;
    if (job.status === "success") return job;
    if (job.status === "failed") throw new Error("Canva could not finish that job.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Canva is still working. Try again in a moment.");
}
