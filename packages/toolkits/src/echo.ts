import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/**
 * Demo toolkit. Copy this file for an app that stores an API key.
 * 1. Export a Toolkit.
 * 2. Add one defineAction per thing the model can do.
 * 3. Register it in ./index.ts.
 * The secret is checked by executeToolkit and is not passed into run.
 */
export const echo: Toolkit = {
  slug: "echo",
  displayName: "LoopAI Echo",
  description: "Demo connection. Proves a stored secret never comes back.",
  authType: "api_key",
  actions: [
    defineAction({
      slug: "echo",
      description: "Repeat the message. Does not return the stored secret.",
      risk: "read",
      input: z.object({ message: z.string().min(1).max(500) }),
      async run(args) {
        return { message: args.message, connected: true };
      },
    }),
  ],
};
