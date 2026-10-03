import { z } from "zod";
import type { Toolkit } from "@loopai/core";
import { defineAction } from "./define";
import { assertPublicUrl, fetchChecked } from "./safe-url";

/**
 * Facts for a profile review. The model writes the roadmap.
 * GitHub and the website are public. LinkedIn is a pasted summary or a connected account, never a scrape.
 */
export const review: Toolkit = {
  slug: "review",
  displayName: "Review",
  description: "Gather a saved resume, a connected GitHub account, a personal site, and LinkedIn name and email.",
  authType: "none",
  actions: [
    defineAction({
      slug: "analyze",
      description: "Collect facts for a goal. Returns the saved resume, GitHub, website, and LinkedIn fields that were actually found. Does not write the roadmap. Pass profileAccount, githubAccount, or linkedinAccount when more than one of that app is connected.",
      risk: "read",
      input: z.object({
        goal: z.string().min(2).max(300),
        github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
        website: z.string().max(300).optional(),
        linkedinSummary: z.string().max(8_000).optional(),
        profileAccount: z.string().max(80).optional(),
        githubAccount: z.string().max(80).optional(),
        linkedinAccount: z.string().max(80).optional(),
      }),
      async run(args, _token, credentials) {
        const token = typeof credentials?.githubAccessToken === "string" ? credentials.githubAccessToken : "";
        const [github, website] = await Promise.all([
          token ? githubFromToken(token) : args.github ? githubFacts(args.github) : Promise.resolve({ missing: "No GitHub account was connected." }),
          args.website ? websiteFacts(args.website) : Promise.resolve({ missing: "No website was given." }),
        ]);
        const name = text(credentials, "profileName");
        const about = text(credentials, "profileAbout");
        const email = text(credentials, "profileEmail");
        const headline = text(credentials, "profileHeadline");
        const skills = text(credentials, "profileSkills");
        const experience = text(credentials, "profileExperience");
        const resume = text(credentials, "profileResume").slice(0, 20_000);
        const saved = name || about || email || headline || skills || experience || resume;
        return {
          goal: args.goal,
          profile: saved ? { name, about, email, headline, skills, experience, resume } : { missing: "No profile was saved." },
          github,
          website,
          linkedin: await linkedinFacts(args.linkedinSummary, credentials?.linkedinAccessToken),
        };
      },
    }),
  ],
};

function text(credentials: Record<string, unknown> | undefined, key: string): string {
  const value = credentials?.[key];
  return typeof value === "string" ? value : "";
}

async function githubFromToken(token: string): Promise<unknown> {
  const [user, repos] = await Promise.all([
    pull("https://api.github.com/user", false, token),
    pull("https://api.github.com/user/repos?sort=updated&per_page=8", false, token),
  ]);
  if (!user || typeof user !== "object") return { error: "GitHub did not respond." };
  const row = user as { login?: unknown };
  const login = typeof row.login === "string" ? row.login : "";
  return shapeGithub(login, user, repos);
}

async function githubFacts(login: string): Promise<unknown> {
  const [user, repos] = await Promise.all([
    pull(`https://api.github.com/users/${login}`),
    pull(`https://api.github.com/users/${login}/repos?sort=updated&per_page=8`),
  ]);
  if (!user) return { error: "GitHub did not respond." };
  return shapeGithub(login, user, repos);
}

function shapeGithub(login: string, user: unknown, repos: unknown) {
  const row = user as { login?: unknown; name?: unknown; bio?: unknown; public_repos?: unknown };
  const list = Array.isArray(repos) ? repos : [];
  return {
    login: typeof row.login === "string" ? row.login : login,
    name: typeof row.name === "string" ? row.name : "",
    bio: typeof row.bio === "string" ? row.bio : "",
    publicRepos: typeof row.public_repos === "number" ? row.public_repos : 0,
    repos: list.slice(0, 8).map((item) => {
      const repo = item as { name?: unknown; description?: unknown; language?: unknown; stargazers_count?: unknown };
      return {
        name: typeof repo.name === "string" ? repo.name : "",
        description: typeof repo.description === "string" ? repo.description : "",
        language: typeof repo.language === "string" ? repo.language : "",
        stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
      };
    }),
  };
}

async function websiteFacts(raw: string): Promise<unknown> {
  const url = await assertPublicUrlForSite(raw);
  const response = await pull(url.toString(), true);
  if (typeof response !== "string" || !response) return { error: "The website did not respond.", url: url.toString() };
  const title = /<title>([^<]{0,120})/i.exec(response)?.[1]?.trim() ?? "";
  const excerpt = response.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4_000);
  return { url: url.toString(), title, excerpt };
}

async function linkedinFacts(summary: string | undefined, token: unknown): Promise<unknown> {
  const note = summary?.trim() ?? "";
  let member: { name?: string; email?: string } | null = null;
  if (typeof token === "string" && token) {
    const data = await pull("https://api.linkedin.com/v2/userinfo", false, token);
    if (data && typeof data === "object") {
      const row = data as { name?: unknown; email?: unknown };
      member = {
        name: typeof row.name === "string" ? row.name : "",
        email: typeof row.email === "string" ? row.email : "",
      };
    }
  }
  if (!note && !member) return { missing: "LinkedIn was not connected." };
  return { ...(member ? { name: member.name, email: member.email } : {}), ...(note ? { summary: note } : {}) };
}

async function assertPublicUrlForSite(raw: string): Promise<URL> {
  try {
    return await assertPublicUrl(raw, { allowLocalhost: false });
  } catch (error) {
    if (error instanceof Error && error.message === "That URL is not valid.") throw new Error("Website URL is not valid.");
    throw new Error("That site is not allowed.");
  }
}

async function pull(url: string, text = false, token?: string): Promise<unknown> {
  try {
    const headers: Record<string, string> = { accept: text ? "text/html" : "application/json", "user-agent": "loopai" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchChecked(url, { headers, signal: AbortSignal.timeout(15_000) }, { allowLocalhost: false });
    if (!response.ok) return null;
    return text ? await response.text() : await response.json();
  } catch (error) {
    if (error instanceof Error && /not allowed|not valid/.test(error.message)) throw error;
    return null;
  }
}
