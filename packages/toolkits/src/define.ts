import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Risk, ToolkitAction } from "@loopai/core";

/** Build an action from a Zod object. The same schema is checked at runtime and shown to the model. */
export function defineAction<S extends z.ZodTypeAny>(def: {
  slug: string;
  description: string;
  risk: Risk;
  input: S;
  /**
   * `token` is the OAuth access token, or null for tools that do not use one.
   * Return only the fields the model needs. Do not return `token`.
   */
  run: (args: z.infer<S>, token: string | null, credentials?: Record<string, unknown>) => Promise<unknown>;
}): ToolkitAction {
  const parameters = zodToJsonSchema(def.input, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
  delete parameters.$schema;
  return {
    slug: def.slug,
    description: def.description,
    risk: def.risk,
    parameters,
    schema: def.input,
    async run(args, token, credentials) {
      return def.run(def.input.parse(args), token, credentials);
    },
  };
}
