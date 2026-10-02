import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { bearerJson } from "./http";
import { googleOAuth } from "./oauth";

/** Google Calendar. Uses the same Google client id as Gmail, with calendar scope only. */
export const googleCalendar: Toolkit = {
  slug: "google-calendar",
  displayName: "Google Calendar",
  description: "Read upcoming events on the primary calendar.",
  authType: "oauth2",
  oauth: googleOAuth([
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ]),
  actions: [
    defineAction({
      slug: "list_events",
      description: "List upcoming events. Returns summary, start, and end. Does not return the access token.",
      risk: "read",
      input: z.object({ maxResults: z.number().int().min(1).max(10).optional() }),
      async run(args, token) {
        const now = new Date().toISOString();
        const data = await bearerJson(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${args.maxResults ?? 5}&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now)}`,
          token!,
        );
        const items = Array.isArray(data.items) ? data.items : [];
        return {
          events: items.map((item) => {
            const event = item as { id?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };
            return {
              id: event.id,
              summary: event.summary ?? null,
              start: event.start?.dateTime ?? event.start?.date ?? null,
              end: event.end?.dateTime ?? event.end?.date ?? null,
            };
          }),
        };
      },
    }),
  ],
};
