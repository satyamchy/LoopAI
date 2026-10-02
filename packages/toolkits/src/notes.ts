import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { notePortFrom } from "./note-port";

/** Save text the user states, then find it again later. */
export const notes: Toolkit = {
  slug: "notes",
  displayName: "Notes",
  description: "Save a note in this workspace and search it later.",
  authType: "none",
  actions: [
    defineAction({
      slug: "save",
      description: "Save a note with a title and body.",
      risk: "write",
      input: z.object({
        title: z.string().min(1).max(160),
        body: z.string().min(1).max(20_000),
      }),
      async run(args, _token, credentials) {
        const saved = await notePortFrom(credentials).save({ kind: "note", title: args.title, body: args.body });
        return { id: saved.id, title: saved.title };
      },
    }),
    defineAction({
      slug: "search",
      description: "Find saved notes whose title or body contains the query.",
      risk: "read",
      input: z.object({ query: z.string().min(1).max(200) }),
      async run(args, _token, credentials) {
        const found = await notePortFrom(credentials).search("note", args.query);
        return { notes: found };
      },
    }),
  ],
};
