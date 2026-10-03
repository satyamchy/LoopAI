import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";

/** HubSpot private app token. The token is not returned. */
export const hubspot: Toolkit = {
  slug: "hubspot",
  displayName: "HubSpot",
  description: "List contacts and create one.",
  authType: "api_key",
  credentialFields: [{ key: "secret", label: "Private app token" }],
  actions: [
    defineAction({
      slug: "list_contacts",
      description: "List contacts. Returns id, email, and name.",
      risk: "read",
      input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      async run(args, token) {
        const data = await bearerJson(
          `https://api.hubapi.com/crm/v3/objects/contacts?limit=${args.limit ?? 10}&properties=email,firstname,lastname`,
          token!,
        );
        const rows = Array.isArray(data.results) ? data.results : [];
        return {
          contacts: rows.map((item) => {
            const row = item as { id?: string; properties?: { email?: string; firstname?: string; lastname?: string } };
            return { id: row.id ?? null, email: row.properties?.email ?? null, name: [row.properties?.firstname, row.properties?.lastname].filter(Boolean).join(" ") };
          }),
        };
      },
    }),
    defineAction({
      slug: "create_contact",
      description: "Create a contact with an email and name.",
      risk: "write",
      confirm: true,
      input: z.object({
        email: z.string().email(),
        firstName: z.string().min(1).max(80),
        lastName: z.string().max(80).optional(),
      }),
      async run(args, token) {
        const data = await bearerJson("https://api.hubapi.com/crm/v3/objects/contacts", token!, {
          method: "POST",
          body: JSON.stringify({ properties: { email: args.email, firstname: args.firstName, lastname: args.lastName ?? "" } }),
        });
        return { id: typeof data.id === "string" ? data.id : null };
      },
    }),
  ],
};
