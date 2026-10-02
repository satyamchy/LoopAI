import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { microsoftOAuth } from "./oauth";

/** Microsoft Teams. Read-only list of teams the signed-in user has joined. */
export const teams: Toolkit = {
  slug: "teams",
  displayName: "Microsoft Teams",
  description: "List teams you have joined.",
  authType: "oauth2",
  oauth: microsoftOAuth(["Team.ReadBasic.All", "User.Read"]),
  actions: [
    defineAction({
      slug: "list_teams",
      description: "List joined teams. Returns id and display name.",
      risk: "read",
      input: z.object({}),
      async run(_args, token) {
        const data = await bearerJson("https://graph.microsoft.com/v1.0/me/joinedTeams", token!);
        const value = Array.isArray(data.value) ? data.value : [];
        return { teams: value.map((team) => ({ id: (team as { id?: string }).id, displayName: (team as { displayName?: string }).displayName })) };
      },
    }),
  ],
};
