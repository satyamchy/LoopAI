import type { SimpleIcon } from "simple-icons";
import {
  siGithub,
  siGmail,
  siGooglecalendar,
  siGoogledrive,
  siGooglesheets,
  siHubspot,
  siJira,
  siLinear,
  siNotion,
  siPerplexity,
  siSupabase,
  siTelegram,
  siWhatsapp,
  siX,
} from "simple-icons";

const brands: Record<string, SimpleIcon> = {
  gmail: siGmail,
  "google-drive": siGoogledrive,
  jira: siJira,
  github: siGithub,
  "google-calendar": siGooglecalendar,
  whatsapp: siWhatsapp,
  telegram: siTelegram,
  perplexity: siPerplexity,
  supabase: siSupabase,
  "google-sheets": siGooglesheets,
  twitter: siX,
  notion: siNotion,
  hubspot: siHubspot,
  linear: siLinear,
};

const drawn: Record<string, { path: string; fill?: string }> = {
  slack: { path: "M5 8.5A2.5 2.5 0 1 1 7.5 6H10v2.5A2.5 2.5 0 0 1 7.5 11 2.5 2.5 0 0 1 5 8.5zM13 5a2.5 2.5 0 1 1 5 0v2.5H15.5A2.5 2.5 0 0 1 13 5zm2.5 5.5H18A2.5 2.5 0 1 1 15.5 13v-2.5zM8.5 13H6a2.5 2.5 0 1 0 2.5 2.5V13z", fill: "#E01E5A" },
  linkedin: { path: "M4 4.2a1.8 1.8 0 1 1-1.8 1.8A1.8 1.8 0 0 1 4 4.2zM2.4 9h3.2v11H2.4zm5.2 0h3.1v1.5h.05a3.4 3.4 0 0 1 3.05-1.7c3.2 0 3.8 2.1 3.8 4.8V20h-3.2v-6c0-1.4-.03-3.2-2-3.2s-2.3 1.5-2.3 3.1V20H7.6z", fill: "#0A66C2" },
  canva: { path: "M12 3a9 9 0 1 0 9 9h-3.2A5.8 5.8 0 1 1 12 6.2z", fill: "#00C4CC" },
  echo: { path: "M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0zm4 0a4 4 0 1 0 8 0 4 4 0 0 0-8 0" },
  outlook: { path: "M3 6h10v12H3V6zm11 1.5 7 4.5-7 4.5V7.5z" },
  teams: { path: "M8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8-1a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 16 10zM3 18c.4-2.4 2.4-4 5-4s4.6 1.6 5 4zm8.2-4.2c1.2.5 2.3 1.4 2.8 2.7.6.3 1.4.5 2 .5 2 0 3.6-1.2 4-3.2" },
  news: { path: "M5 5h11v14H5V5zm2 3h7v2H7V8zm0 4h7v1.5H7V12zm0 3h4v1.5H7V15zM17 7h2v12h-2z" },
  "patna-hc": { path: "M12 3 4 7v2h16V7L12 3zM6 11h2v6H6v-6zm5 0h2v6h-2v-6zm5 0h2v6h-2v-6zM4 19h16v2H4v-2z" },
  "custom-mcp": { path: "M8 7h3v3H8V7zm5 0h3v3h-3V7zM8 14h3v3H8v-3zm5 1.5h3V18h-3v-2.5z" },
  profile: { path: "M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12zm-6 7c.6-2.8 3-4.5 6-4.5s5.4 1.7 6 4.5z" },
  jobs: { path: "M8 7V5h8v2h5v12H3V7h5zm2 0h4V6h-4v1z" },
  notes: { path: "M7 3h8l4 4v14H7V3zm7 1.5V8h3.5z" },
  manuscript: { path: "M5 4h9a4 4 0 0 1 4 4v12H8a3 3 0 0 0-3 3V4zm3 5h7v1.5H8V9zm0 3.5h7V14H8v-1.5z" },
};

export function AppLogo({ slug, name }: { slug: string; name: string }) {
  if (slug === "hindi-render") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-orange-50 text-sm font-bold text-orange-700 ring-1 ring-stone-200" aria-label={name}>हि</span>
    );
  }
  const brand = brands[slug];
  const mark = drawn[slug];
  const path = brand?.path ?? mark?.path;
  const fill = brand ? `#${brand.hex}` : (mark?.fill ?? "#c2410c");
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white ring-1 ring-stone-200">
      {path ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" role="img" aria-label={name}>
          <path d={path} fill={fill} />
        </svg>
      ) : (
        <span className="text-sm font-bold text-orange-700">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
