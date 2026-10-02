import { redact } from "@loopai/core";

type Message = Record<string, unknown>;

const SYSTEM = [
  "You are LoopAI. Facts about email, files, issues, and court cases come only from tool results.",
  "If a tool does not return a fact, say you do not have it. Do not invent dates, statuses, or message contents.",
  "When the user writes in Hindi, answer in Hindi.",
  "For a Patna High Court question, call patna-hc first. Then call hindi-render with sourceText from that result only.",
].join(" ");

/**
 * Provider-native tool calling. This is not LangChain.
 * The loop sends JSON schemas, runs the matching tool, and returns the redacted result.
 * When a workspace has too many actions to fit, add a search_tools step before this list.
 */
export async function runToolLoop(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  history: { role: string; content: string }[];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  callTool: (name: string, args: unknown) => Promise<unknown>;
  fetchImpl: typeof fetch;
  secrets: string[];
}): Promise<{ text: string; toolsUsed: string[] }> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    ...options.history.map((item) => ({ role: item.role, content: item.content })),
  ];
  const toolsUsed: string[] = [];
  const tools = options.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  for (let round = 0; round < 4; round += 1) {
    const response = await options.fetchImpl(options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: options.model, messages, tools: tools.length ? tools : undefined }),
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      const safe = raw.length < 180 && !raw.includes(options.apiKey) ? raw : `LLM provider returned ${response.status}`;
      throw new Error(safe);
    }
    const payload = JSON.parse(raw) as { choices?: { message?: Message }[] };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("LLM provider returned an empty response.");
    messages.push(message);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) {
      return { text: typeof message.content === "string" ? message.content : "", toolsUsed };
    }
    for (const call of calls as { id?: string; function?: { name?: string; arguments?: string } }[]) {
      const name = call.function?.name ?? "";
      toolsUsed.push(name);
      let args: unknown = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      let content: string;
      try {
        content = clip(await options.callTool(name, args), options.secrets);
      } catch (error) {
        content = clip({ error: error instanceof Error ? error.message : "Tool failed" }, options.secrets);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { text: "I could not finish that with the connected tools.", toolsUsed };
}

/** One entry per model host. A new host is a new object here, then it appears in Chat. */
export const modelProviders = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { id: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  { id: "compatible", label: "Custom", baseUrl: "", defaultModel: "" },
];

export function providerBaseUrl(provider: string, baseUrl: string | null): string {
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  const known = modelProviders.find((item) => item.id === provider && item.baseUrl);
  if (!known) throw new Error("Set a base URL for this provider.");
  return known.baseUrl;
}

function clip(value: unknown, secrets: string[]): string {
  const text = JSON.stringify(redact(value, secrets));
  return text.length > 8000 ? `${text.slice(0, 8000)}…[truncated]` : text;
}
