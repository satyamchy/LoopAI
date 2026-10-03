import type { Toolkit, ToolkitCard } from "@loopai/core";
import { clientConfigured } from "./oauth";

/** Cards with no module yet. Connect stays disabled until a toolkit file exists. */
const planned: ToolkitCard[] = [];

/** Grid data for the dashboard. Implemented toolkits come first. */
export function listCards(toolkits: Toolkit[]): ToolkitCard[] {
  return [
    ...toolkits.map((toolkit) => ({
      slug: toolkit.slug,
      displayName: toolkit.displayName,
      description: toolkit.description,
      authType: toolkit.authType,
      implemented: true,
      configured: toolkit.oauth ? clientConfigured(toolkit.oauth) : true,
      setupEnv: toolkit.oauth ? `${toolkit.oauth.clientIdEnv} and ${toolkit.oauth.clientSecretEnv}` : null,
      credentialFields: toolkit.credentialFields ?? (toolkit.authType === "api_key" ? [{ key: "secret", label: "Secret" }] : []),
      actions: toolkit.actions.map(({ slug, description, risk }) => ({ slug, description, risk })),
    })),
    ...planned,
  ];
}
