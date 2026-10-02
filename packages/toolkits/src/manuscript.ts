import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { notePortFrom } from "./note-port";

/** Chapters for a book. Chat writes the prose. This stores it. */
export const manuscript: Toolkit = {
  slug: "manuscript",
  displayName: "Manuscript",
  description: "Keep book chapters and continue them later.",
  authType: "none",
  actions: [
    defineAction({
      slug: "add_chapter",
      description: "Save a new chapter. The body is the prose to keep.",
      risk: "write",
      input: z.object({
        title: z.string().min(1).max(160),
        body: z.string().min(1).max(20_000),
      }),
      async run(args, _token, credentials) {
        const saved = await notePortFrom(credentials).save({ kind: "chapter", title: args.title, body: args.body });
        return { id: saved.id, title: saved.title };
      },
    }),
    defineAction({
      slug: "list_chapters",
      description: "List saved chapters with their text.",
      risk: "read",
      input: z.object({}),
      async run(_args, _token, credentials) {
        return { chapters: await notePortFrom(credentials).list("chapter") };
      },
    }),
    defineAction({
      slug: "read_chapter",
      description: "Read one chapter by id.",
      risk: "read",
      input: z.object({ id: z.string().min(8).max(80) }),
      async run(args, _token, credentials) {
        const chapter = await notePortFrom(credentials).read(args.id);
        if (!chapter || chapter.kind !== "chapter") throw new Error("Chapter not found.");
        return { id: chapter.id, title: chapter.title, body: chapter.body };
      },
    }),
    defineAction({
      slug: "append",
      description: "Add more prose to an existing chapter.",
      risk: "write",
      input: z.object({
        id: z.string().min(8).max(80),
        text: z.string().min(1).max(20_000),
      }),
      async run(args, _token, credentials) {
        const chapter = await notePortFrom(credentials).append(args.id, args.text);
        if (!chapter) throw new Error("Chapter not found.");
        return { id: chapter.id, title: chapter.title };
      },
    }),
  ],
};
