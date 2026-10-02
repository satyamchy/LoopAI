import type { Toolkit } from "@loopai/core";
import { echo } from "./echo";
import { gmail } from "./gmail";
import { googleDrive } from "./google-drive";
import { slack } from "./slack";
import { outlook } from "./outlook";
import { teams } from "./teams";
import { jira } from "./jira";
import { github } from "./github";
import { linkedin } from "./linkedin";
import { googleCalendar } from "./google-calendar";
import { whatsapp } from "./whatsapp";
import { telegram } from "./telegram";
import { news } from "./news";
import { patnaHc } from "./patna-hc";
import { hindiRender } from "./hindi-render";
import { perplexity } from "./perplexity";
import { supabase } from "./supabase";
import { customMcp } from "./custom-mcp";
import { googleSheets } from "./google-sheets";
import { twitter } from "./twitter";
import { profile } from "./profile";
import { jobs } from "./jobs";
import { notes } from "./notes";
import { manuscript } from "./manuscript";
import { canva } from "./canva";

/**
 * Registry. To add a tool: create a file, export a Toolkit, and append it here.
 * Agents are not registered here. They call the API.
 */
export const toolkits: Toolkit[] = [
  echo,
  gmail,
  slack,
  outlook,
  googleDrive,
  teams,
  jira,
  github,
  linkedin,
  googleCalendar,
  whatsapp,
  telegram,
  news,
  patnaHc,
  hindiRender,
  perplexity,
  supabase,
  customMcp,
  googleSheets,
  twitter,
  profile,
  jobs,
  notes,
  manuscript,
  canva,
];

export function findToolkit(slug: string): Toolkit | null {
  return toolkits.find((toolkit) => toolkit.slug === slug) ?? null;
}

export { executeToolkit } from "./execute";
export type { NotePort } from "./note-port";
export { authorizeUrl, clientConfigured, exchangeCode, refreshAccessToken } from "./oauth";
export { listCards } from "./catalog";
export { echo, gmail, hindiRender, patnaHc };
