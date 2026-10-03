import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/**
 * HR intro. The page stores the note. Sending uses the workspace Gmail account.
 * The API puts that access token on credentials before this runs.
 */
export const profile: Toolkit = {
  slug: "profile",
  displayName: "Profile",
  description: "Your name, contact details, and the note you send to one address.",
  authType: "api_key",
  credentialFields: [
    { key: "fullName", label: "Name", secret: false },
    { key: "email", label: "Email", secret: false },
    { key: "phone", label: "Phone", secret: false, optional: true },
    { key: "headline", label: "Headline", secret: false, optional: true },
    { key: "skills", label: "Skills", secret: false, optional: true },
    { key: "experience", label: "Experience", secret: false, optional: true, long: true },
    { key: "resumeText", label: "Resume", secret: false, optional: true, long: true },
    { key: "about", label: "Short note", secret: false },
    { key: "subject", label: "Subject", secret: false },
    { key: "body", label: "Email body", secret: false },
  ],
  actions: [
    defineAction({
      slug: "read",
      description: "Read the saved name, headline, skills, experience, resume, email, phone, note, subject, and body.",
      risk: "read",
      input: z.object({}),
      async run(_args, _token, credentials) {
        return {
          name: text(credentials, "fullName"),
          email: text(credentials, "email"),
          phone: text(credentials, "phone"),
          headline: text(credentials, "headline"),
          skills: text(credentials, "skills"),
          experience: text(credentials, "experience"),
          resume: text(credentials, "resumeText").slice(0, 20_000),
          about: text(credentials, "about"),
          subject: text(credentials, "subject"),
          body: text(credentials, "body"),
        };
      },
    }),
    defineAction({
      slug: "send_intro",
      description: "Send the saved note to one email address through the connected Gmail account. Pass subject or body to override the saved text for this send only. Pass gmailAccount when more than one Gmail account is connected.",
      risk: "write",
      confirm: true,
      input: z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(200).optional(),
        body: z.string().min(1).max(10_000).optional(),
        gmailAccount: z.string().max(80).optional(),
      }),
      async run(args, _token, credentials) {
        const token = credentials?.gmailAccessToken;
        if (typeof token !== "string" || !token) throw new Error("Connect Gmail before sending an intro email.");
        const name = text(credentials, "fullName");
        const email = text(credentials, "email");
        const phone = text(credentials, "phone");
        const subject = args.subject ?? text(credentials, "subject");
        const note = args.body ?? text(credentials, "body");
        const signature = [name, email, phone].filter(Boolean).join("\n");
        const message = [note, "", signature].filter(Boolean).join("\n");
        const raw = Buffer.from(
          [`To: ${args.to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", message].join("\r\n"),
        ).toString("base64url");
        const sent = await bearerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", token, {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return { id: sent.id ?? null, to: args.to };
      },
    }),
  ],
};

function text(credentials: Record<string, unknown> | undefined, key: string): string {
  const value = credentials?.[key];
  return typeof value === "string" ? value : "";
}
