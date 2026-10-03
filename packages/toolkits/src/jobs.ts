import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { notePortFrom } from "./note-port";

type Job = { title: string; company: string; location: string; url: string };

/** Public listings only. This does not sign into a job portal. */
export const jobs: Toolkit = {
  slug: "jobs",
  displayName: "Jobs",
  description: "Search public role listings and save an application against the saved profile.",
  authType: "none",
  actions: [
    defineAction({
      slug: "search",
      description: "Find roles matching the title the user typed. Uses saved profile skills when a profile is connected. Returns title, company, location, and url.",
      risk: "read",
      input: z.object({
        role: z.string().min(2).max(80),
        profileAccount: z.string().max(80).optional(),
      }),
      async run(args, _token, credentials) {
        const query = encodeURIComponent(args.role.trim());
        const skills = text(credentials, "profileSkills");
        const headline = text(credentials, "profileHeadline");
        const pulls = [
          pull(`https://remotive.com/api/remote-jobs?search=${query}`),
          pull(`https://www.arbeitnow.com/api/job-board-api?search=${query}`),
        ];
        const adzuna = adzunaUrl(args.role);
        if (adzuna) pulls.push(pull(adzuna));
        const [remote, board, india] = await Promise.all(pulls);
        if (!remote && !board && !india) throw new Error("Job search did not respond.");
        const found = [...remotive(remote), ...arbeitnow(board), ...adzunaJobs(india)];
        const ranked = found
          .map((job) => ({ job, score: scoreJob(args.role, skills, headline, job) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((item) => item.job);
        return skills || headline ? { jobs: ranked, usedProfile: true } : { jobs: ranked };
      },
    }),
    defineAction({
      slug: "save_application",
      description: "Save a job application note with the company, role, and url.",
      risk: "write",
      input: z.object({
        company: z.string().min(1).max(120),
        role: z.string().min(1).max(120),
        url: z.string().url().max(400).optional(),
      }),
      async run(args, _token, credentials) {
        const saved = await notePortFrom(credentials).save({
          kind: "application",
          title: `${args.role} at ${args.company}`,
          body: [args.role, args.company, args.url ?? ""].filter(Boolean).join("\n"),
        });
        return { id: saved.id, title: saved.title };
      },
    }),
  ],
};

function text(credentials: Record<string, unknown> | undefined, key: string): string {
  const value = credentials?.[key];
  return typeof value === "string" ? value : "";
}

function adzunaUrl(role: string): string | null {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return null;
  const params = new URLSearchParams({ app_id: id, app_key: key, results_per_page: "20", what: role.trim() });
  return `https://api.adzuna.com/v1/api/jobs/in/search/1?${params}`;
}

function scoreJob(role: string, skills: string, headline: string, job: Job): number {
  const hay = `${job.title} ${job.company} ${job.location}`.toLowerCase();
  const roleWords = role.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  let score = hay.includes(role.trim().toLowerCase()) ? 3 : 0;
  score += roleWords.filter((word) => hay.includes(word)).length;
  const extra = `${skills} ${headline}`.toLowerCase().split(/[^a-z0-9+#.]+/).filter((word) => word.length > 2);
  score += extra.filter((word) => hay.includes(word)).length;
  return score;
}

function adzunaJobs(payload: unknown): Job[] {
  const jobs = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, 20).map((item) => {
    const row = item as { title?: unknown; company?: { display_name?: unknown }; location?: { display_name?: unknown }; redirect_url?: unknown };
    return job(row.title, row.company?.display_name, row.location?.display_name, row.redirect_url);
  }).filter((item): item is Job => item !== null);
}

async function pull(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "loopai" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function remotive(payload: unknown): Job[] {
  const jobs = (payload as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, 20).map((item) => {
    const row = item as { title?: unknown; company_name?: unknown; candidate_required_location?: unknown; url?: unknown };
    return job(row.title, row.company_name, row.candidate_required_location, row.url);
  }).filter((item): item is Job => item !== null);
}

function arbeitnow(payload: unknown): Job[] {
  const jobs = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, 20).map((item) => {
    const row = item as { title?: unknown; company_name?: unknown; location?: unknown; url?: unknown };
    return job(row.title, row.company_name, row.location, row.url);
  }).filter((item): item is Job => item !== null);
}

function job(title: unknown, company: unknown, location: unknown, url: unknown): Job | null {
  if (typeof title !== "string" || typeof url !== "string" || !url.startsWith("http")) return null;
  return {
    title,
    company: typeof company === "string" ? company : "",
    location: typeof location === "string" ? location : "",
    url,
  };
}
