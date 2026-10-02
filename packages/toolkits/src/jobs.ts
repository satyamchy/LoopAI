import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";

type Job = { title: string; company: string; location: string; url: string };

/** Public listings only. This does not sign into a job portal. */
export const jobs: Toolkit = {
  slug: "jobs",
  displayName: "Jobs",
  description: "Search public role listings on Remotive and Arbeitnow.",
  authType: "none",
  actions: [
    defineAction({
      slug: "search",
      description: "Find roles matching the title the user typed. Returns title, company, location, and url.",
      risk: "read",
      input: z.object({ role: z.string().min(2).max(80) }),
      async run(args) {
        const query = encodeURIComponent(args.role.trim());
        const [remote, board] = await Promise.all([
          pull(`https://remotive.com/api/remote-jobs?search=${query}`),
          pull(`https://www.arbeitnow.com/api/job-board-api?search=${query}`),
        ]);
        if (!remote && !board) throw new Error("Job search did not respond.");
        const found = [...remotive(remote), ...arbeitnow(board)].filter((job) => matches(args.role, job));
        return { jobs: found.slice(0, 12) };
      },
    }),
  ],
};

function matches(role: string, job: Job): boolean {
  const hay = `${job.title} ${job.company}`.toLowerCase();
  const needle = role.trim().toLowerCase();
  const words = needle.split(/\s+/).filter((word) => word.length > 2);
  return hay.includes(needle) || words.some((word) => hay.includes(word));
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
