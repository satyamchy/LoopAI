import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "react-router-dom";
import { api, downloadFile, type DownloadRef, type LlmConnection, type ProviderOption } from "../api";

type Bubble = { role: "user" | "assistant"; content: string; tools?: string[]; downloads?: DownloadRef[]; failed?: boolean };

const tasks = [
  "Compare AI model prices across providers",
  "Find which brands win an Amazon search",
  "Find the fastest-rising research on a topic",
  "Find currency risks in company filings",
  "Test common cooking myths with real science",
];

export function Chat() {
  const [params, setParams] = useSearchParams();
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [models, setModels] = useState<LlmConnection[]>([]);
  const [modelId, setModelId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(params.get("c"));
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [provider, setProvider] = useState("groq");
  const [model, setModel] = useState("openai/gpt-oss-20b");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const skipLoad = useRef<string | null>(null);
  const opened = params.get("c");

  async function load() {
    const [providerList, saved] = await Promise.all([
      api<{ providers: ProviderOption[] }>("/v1/providers"),
      api<{ connections: LlmConnection[] }>("/v1/llm-connections"),
    ]);
    setProviders(providerList.providers);
    setModels(saved.connections);
    setModelId((current) => current || saved.connections[0]?.id || "");
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!opened) {
      setConversationId(null);
      setBubbles([]);
      return;
    }
    if (skipLoad.current === opened) {
      skipLoad.current = null;
      setConversationId(opened);
      return;
    }
    setConversationId(opened);
    api<{ messages: { role: string; content: string }[] }>(`/v1/conversations/${opened}/messages`)
      .then((loaded) => setBubbles(loaded.messages.filter((item) => item.role === "user" || item.role === "assistant") as Bubble[]))
      .catch((reason: Error) => setError(reason.message));
  }, [opened]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [bubbles, sending]);

  function pickProvider(id: string) {
    const chosen = providers.find((item) => item.id === id);
    setProvider(id);
    setModel(chosen?.defaultModel ?? "");
    setBaseUrl(id === "compatible" ? "" : chosen?.baseUrl ?? "");
  }

  async function addModel(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const saved = await api<LlmConnection>("/v1/llm-connections", {
      method: "POST",
      body: JSON.stringify({ provider, model, apiKey, baseUrl: baseUrl || undefined }),
    });
    setApiKey("");
    setShowModels(false);
    setModelId(saved.id);
    await load();
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    if (!modelId) {
      setShowModels(true);
      setError("Add a model before sending.");
      return;
    }
    setDraft("");
    setError(null);
    setSending(true);
    setBubbles((current) => [...current, { role: "user", content: message }]);
    try {
      const result = await api<{ conversationId: string; reply: string; tools: string[]; downloads: DownloadRef[] }>("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ llmConnectionId: modelId, message, conversationId }),
      });
      setConversationId(result.conversationId);
      skipLoad.current = result.conversationId;
      setParams({ c: result.conversationId }, { replace: true });
      setBubbles((current) => [...current, { role: "assistant", content: result.reply, tools: result.tools, downloads: result.downloads }]);
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Chat failed";
      setBubbles((current) => [...current, { role: "assistant", content: text, failed: true }]);
      setError(text);
    } finally {
      setSending(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send().catch((reason: Error) => setError(reason.message));
    }
  }

  const selected = models.find((item) => item.id === modelId);

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-stone-900 text-stone-100">
      <header className="flex shrink-0 justify-end gap-2 border-b border-stone-700 px-5 py-3">
        <select className="rounded-none border border-stone-600 bg-stone-800 px-2 py-2" value={modelId} onChange={(event) => setModelId(event.target.value)}>
          <option value="">Select a model</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>{item.provider} · {item.model}</option>
          ))}
        </select>
        <button className="rounded-md border border-stone-500 px-3 py-2 text-sm" type="button" onClick={() => setShowModels(true)}>Add model</button>
      </header>
      <div className="min-h-0 overflow-y-auto px-6 py-8 md:px-[16%]" ref={thread}>
        <div className="flex min-h-full flex-col justify-end gap-3">
        {bubbles.length === 0 && (
          <div className="w-full text-center">
            <h1 className="text-4xl font-semibold tracking-tight">Test models against real knowledge work</h1>
            <p className="mt-3 text-stone-400">Pick a task or ask about a connected app.</p>
            <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
              {tasks.map((task) => (
                <button key={task} className="rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-left text-sm" type="button" onClick={() => setDraft(task)}>{task}</button>
              ))}
            </div>
          </div>
        )}
        {bubbles.map((bubble, index) => (
          <article key={`${bubble.role}-${index}`} className={bubble.failed ? "max-w-[80%] border border-red-900 bg-red-950 px-3 py-2" : bubble.role === "user" ? "ml-auto max-w-[80%] border border-orange-800 bg-orange-950 px-3 py-2" : "max-w-[80%] border border-stone-700 bg-stone-800 px-3 py-2"}>
            {bubble.role === "assistant" && !bubble.failed ? (
              <div className="reply"><ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.content}</ReactMarkdown></div>
            ) : (
              <p className="whitespace-pre-wrap">{bubble.content}</p>
            )}
            {bubble.tools && bubble.tools.length > 0 && <small className="text-stone-400">Used {bubble.tools.join(", ")}</small>}
            {bubble.role === "assistant" && !bubble.failed && (
              <div className="mt-2 grid gap-2">
                <div className="flex flex-wrap gap-2">
                  {(["pdf", "docx", "xlsx"] as const).map((format) => (
                    <button key={format} className="rounded-md border border-stone-500 px-2 py-1 text-xs" type="button" onClick={() => downloadFile({ format, title: "Chat", text: bubble.content }, `chat.${format}`).catch((reason: Error) => setError(reason.message))}>
                      {format === "docx" ? "Word" : format === "xlsx" ? "Excel" : "PDF"}
                    </button>
                  ))}
                </div>
                {bubble.downloads?.filter((item) => item.tabular).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-stone-400">{item.tool}</span>
                    {(["pdf", "docx", "xlsx"] as const).map((format) => (
                      <button key={format} className="rounded-md border border-stone-500 px-2 py-1 text-xs" type="button" onClick={() => downloadFile({ format, executionId: item.id, title: item.tool }, `${item.tool}.${format}`).catch((reason: Error) => setError(reason.message))}>
                        {format === "docx" ? "Word" : format === "xlsx" ? "Excel" : "PDF"}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
        {sending && <article className="text-stone-400">Thinking…</article>}
        </div>
      </div>
      <div className="shrink-0">
      {error && <p className="mx-6 border border-red-900 bg-red-950 px-3 py-2 md:mx-[16%]">{error}</p>}
      <form className="flex items-end gap-2 px-6 pb-2 md:px-[16%]" onSubmit={(event) => send(event)}>
        <textarea
          className="min-h-12 flex-1 resize-none rounded-none border border-stone-600 bg-stone-800 px-3 py-3"
          rows={1}
          placeholder={selected ? "Send a message..." : "Add a model to start"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
        />
        <button className="rounded-md bg-orange-500 px-3 py-2 font-semibold text-white disabled:bg-stone-700" type="submit" disabled={sending || !draft.trim()}>Send</button>
      </form>
      <p className="px-6 pb-4 text-xs text-stone-400 md:px-[16%]">Enter sends. Shift+Enter adds a line.</p>
      </div>
      {showModels && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/50 p-4">
          <form className="grid w-full max-w-md gap-3 bg-white p-5 text-stone-900" onSubmit={(event) => addModel(event).catch((reason: Error) => setError(reason.message))}>
            <h2 className="text-lg font-semibold">Add a model</h2>
            <label className="grid gap-1 text-sm">
              Provider
              <select className="rounded-none border border-stone-300 px-2 py-2" value={provider} onChange={(event) => pickProvider(event.target.value)}>
                {providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Model
              <input className="rounded-none border border-stone-300 px-2 py-2" value={model} onChange={(event) => setModel(event.target.value)} required placeholder="gpt-4o-mini" />
            </label>
            <label className="grid gap-1 text-sm">
              Base URL
              <input className="rounded-none border border-stone-300 px-2 py-2" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Required for a custom provider" />
            </label>
            <label className="grid gap-1 text-sm">
              API key
              <input className="rounded-none border border-stone-300 px-2 py-2" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required minLength={8} autoComplete="off" />
            </label>
            <p className="text-sm text-stone-500">OpenAI, Gemini, Groq, and OpenRouter are built in. Any other host that speaks the OpenAI chat API goes in as Custom.</p>
            <div className="flex justify-end gap-2">
              <button className="rounded-md border border-stone-300 px-3 py-2" type="button" onClick={() => setShowModels(false)}>Cancel</button>
              <button className="rounded-md bg-orange-500 px-3 py-2 font-semibold text-white" type="submit">Save model</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
