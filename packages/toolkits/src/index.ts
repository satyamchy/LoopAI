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
];

export function findToolkit(slug: string): Toolkit | null {
  return toolkits.find((toolkit) => toolkit.slug === slug) ?? null;
}

export { executeToolkit } from "./execute";
export { authorizeUrl, clientConfigured, exchangeCode, refreshAccessToken } from "./oauth";
export { listCards } from "./catalog";
export { echo, gmail, hindiRender, patnaHc };
