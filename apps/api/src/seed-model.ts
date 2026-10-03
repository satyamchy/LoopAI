import { modelProviders } from "./run-tool-loop";
import type { Store } from "./store";

/** Save the local Groq key into this workspace once. The key is not logged. */
export async function seedGroq(store: Store, workspaceId: string): Promise<void> {
  const key = process.env.GROQ_API_KEY;
  const groq = modelProviders.find((item) => item.id === "groq");
  if (!key || key.length < 8 || !groq?.defaultModel) return;
  const saved = await store.listLlms(workspaceId);
  if (saved.some((item) => item.provider === "groq" && item.model === groq.defaultModel)) return;
  await store.insertLlm({
    workspaceId,
    provider: "groq",
    model: groq.defaultModel,
    baseUrl: null,
    encryptedApiKey: await store.encrypt(workspaceId, { apiKey: key }),
  });
}
