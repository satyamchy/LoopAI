import { redact } from "@loopai/core";

type Message = Record<string, unknown>;

const SYSTEM = [
  "You are LoopAI. Facts about email, files, issues, and court cases come only from tool results.",
  "If a tool does not return a fact, say you do not have it. Do not invent dates, statuses, or message contents.",
  "When the user writes in Hindi, answer in Hindi.",
  "For a Patna High Court question, call patna-hc first. Then call hindi-render with sourceText from that result only.",
  "Use profile then Gmail when the user asks to email an intro. Use jobs.search for a role. Use notes or manuscript for saved text. Use Canva when the user asks for a design.",
  "When the user asks to review their profile, GitHub, site, or wants a roadmap, call review.analyze, then write strengths, gaps, and a roadmap using only that result. The result includes the saved resume, skills, and a connected GitHub account when those exist.",
  "If more than one account is connected, pass the account id the error lists. Do not guess.",
  "Format the answer with short headings and lists. When a tool returns rows, show them as a Markdown table.",
].join(" ");

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };

export type PendingApproval = { id: string; summary: string; toolkit: string; action: string };

/** The model asked for an external write. The loop stops until a person confirms. */
export class ApprovalRequired extends Error {
  constructor(readonly pending: PendingApproval) {
    super("Approval required");
    this.name = "ApprovalRequired";
  }
}

const SEARCH = {
  name: "search_tools",
  description: "Find connected actions by words from the user's request. Returns name and description.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

/** Keep the actions that match this message. Offer search when the rest are left out. */
export function selectTools(message: string, tools: ToolDef[]): ToolDef[] {
  const words = message.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const ranked = tools
    .map((tool) => {
      const hay = `${tool.name} ${tool.description}`.toLowerCase().replaceAll("_", " ");
      const score = words.reduce((total, word) => total + (hay.includes(word) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((item) => item.tool);
  const chosen = ranked.length > 0 ? ranked : tools.slice(0, 16);
  if (tools.length > chosen.length) return [...chosen, SEARCH];
  return chosen;
}

/**
 * Provider-native tool calling. This is not LangChain.
 * The loop sends JSON schemas, runs the matching tool, and returns the redacted result.
 */
export async function runToolLoop(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  history: { role: string; content: string }[];
  tools: ToolDef[];
  catalog?: ToolDef[];
  callTool: (name: string, args: unknown) => Promise<unknown>;
  fetchImpl: typeof fetch;
  secrets: string[];
  onDelta?: (text: string) => void;
}): Promise<{ text: string; toolsUsed: string[]; pending?: PendingApproval }> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    ...options.history.map((item) => ({ role: item.role, content: item.content })),
  ];
  const toolsUsed: string[] = [];
  const catalog = options.catalog ?? options.tools;
  let tools = options.tools.map(asFunction);

  for (let round = 0; round < 6; round += 1) {
    const message = options.onDelta
      ? await streamCompletion(options, messages, tools)
      : await jsonCompletion(options, messages, tools);
    messages.push(message);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) {
      const text = typeof message.content === "string" ? message.content : "";
      return { text, toolsUsed };
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
      if (name === "search_tools") {
        const query = typeof (args as { query?: unknown }).query === "string" ? (args as { query: string }).query : "";
        const found = selectTools(query, catalog).filter((tool) => tool.name !== "search_tools");
        for (const tool of found) {
          if (!tools.some((item) => (item.function as { name?: string }).name === tool.name)) tools.push(asFunction(tool));
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: clip(found.map((tool) => ({ name: tool.name, description: tool.description })), options.secrets) });
        continue;
      }
      let content: string;
      try {
        content = clip(await options.callTool(name, args), options.secrets);
      } catch (error) {
        if (error instanceof ApprovalRequired) return { text: error.pending.summary, toolsUsed, pending: error.pending };
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
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-20b" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  { id: "compatible", label: "Custom", baseUrl: "", defaultModel: "" },
];

export function providerBaseUrl(provider: string, baseUrl: string | null): string {
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  const known = modelProviders.find((item) => item.id === provider && item.baseUrl);
  if (!known) throw new Error("Set a base URL for this provider.");
  return known.baseUrl;
}

function asFunction(tool: ToolDef) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

async function jsonCompletion(options: { endpoint: string; apiKey: string; model: string; fetchImpl: typeof fetch }, messages: Message[], tools: unknown[]): Promise<Message> {
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
  return message;
}

async function streamCompletion(options: { endpoint: string; apiKey: string; model: string; fetchImpl: typeof fetch; onDelta?: (text: string) => void }, messages: Message[], tools: unknown[]): Promise<Message> {
  const response = await options.fetchImpl(options.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: options.model, messages, tools: tools.length ? tools : undefined, stream: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    const raw = await response.text();
    const safe = raw.length < 180 && !raw.includes(options.apiKey) ? raw : `LLM provider returned ${response.status}`;
    throw new Error(safe);
  }
  const message: Message = { role: "assistant", content: "" };
  const calls = new Map<number, { id?: string; type?: string; function: { name: string; arguments: string } }>();
  let data = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    data += decoder.decode(chunk.value, { stream: true });
    const parts = data.split("\n");
    data = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const json = JSON.parse(payload) as { choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
      const delta = json.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) {
        message.content = `${message.content}${delta.content}`;
        options.onDelta?.(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const current = calls.get(index) ?? { id: call.id, type: "function", function: { name: "", arguments: "" } };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name += call.function.name;
        if (call.function?.arguments) current.function.arguments += call.function.arguments;
        calls.set(index, current);
      }
    }
  }
  if (calls.size > 0) message.tool_calls = [...calls.values()];
  if (!message.content) message.content = null;
  return message;
}

function clip(value: unknown, secrets: string[]): string {
  const text = JSON.stringify(redact(value, secrets));
  return text.length > 16_000 ? `${text.slice(0, 16_000)}…[truncated]` : text;
}
