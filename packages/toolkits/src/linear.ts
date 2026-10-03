import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

/** Linear personal API key. The key is sent as the Authorization header and is not returned. */
export const linear: Toolkit = {
  slug: "linear",
  displayName: "Linear",
  description: "List issues and create one.",
  authType: "api_key",
  credentialFields: [{ key: "secret", label: "Personal API key" }],
  actions: [
    defineAction({
      slug: "list_issues",
      description: "List recent issues. Returns id, identifier, and title.",
      risk: "read",
      input: z.object({}),
      async run(_args, token) {
        const data = await linearQuery(token!, "query { issues(first: 10) { nodes { id identifier title } } }");
        const nodes = (data.issues as { nodes?: { id?: string; identifier?: string; title?: string }[] } | undefined)?.nodes ?? [];
        return { issues: nodes.map((issue) => ({ id: issue.id ?? null, identifier: issue.identifier ?? null, title: issue.title ?? null })) };
      },
    }),
    defineAction({
      slug: "create_issue",
      description: "Create an issue on a team. teamId is the Linear team id.",
      risk: "write",
      confirm: true,
      input: z.object({
        teamId: z.string().min(4).max(80),
        title: z.string().min(1).max(200),
        description: z.string().max(8000).optional(),
      }),
      async run(args, token) {
        const data = await linearQuery(
          token!,
          "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier } } }",
          { input: { teamId: args.teamId, title: args.title, description: args.description ?? "" } },
        );
        const issue = (data.issueCreate as { issue?: { id?: string; identifier?: string } } | undefined)?.issue;
        return { id: issue?.id ?? null, identifier: issue?.identifier ?? null };
      },
    }),
  ],
};

async function linearQuery(token: string, query: string, variables?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Upstream api.linear.app returned ${response.status}`);
  const json = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown };
  if (json.errors) throw new Error("Linear rejected the query.");
  return json.data ?? {};
}
