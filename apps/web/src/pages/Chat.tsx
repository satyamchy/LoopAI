import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, type LlmConnection, type ProviderOption } from "../api";

type Bubble = { role: "user" | "assistant"; content: string; tools?: string[]; failed?: boolean };
type Conversation = { id: string; title: string };

export function Chat() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [models, setModels] = useState<LlmConnection[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [modelId, setModelId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  async function load() {
    const [providerList, saved, history] = await Promise.all([
      api<{ providers: ProviderOption[] }>("/v1/providers"),
      api<{ connections: LlmConnection[] }>("/v1/llm-connections"),
      api<{ conversations: Conversation[] }>("/v1/conversations"),
    ]);
    setProviders(providerList.providers);
    setModels(saved.connections);
    setConversations(history.conversations);
    setModelId((current) => current || saved.connections[0]?.id || "");
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

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

  function newChat() {
    setConversationId(null);
    setBubbles([]);
    setError(null);
    setDraft("");
  }

  async function openConversation(id: string) {
    setError(null);
    setConversationId(id);
    const loaded = await api<{ messages: { role: string; content: string }[] }>(`/v1/conversations/${id}/messages`);
    setBubbles(loaded.messages.filter((item) => item.role === "user" || item.role === "assistant") as Bubble[]);
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
      const result = await api<{ conversationId: string; reply: string; tools: string[] }>("/v1/chat", {
        method: "POST",
        body: JSON.stringify({ llmConnectionId: modelId, message, conversationId }),
      });
      setConversationId(result.conversationId);
      setBubbles((current) => [...current, { role: "assistant", content: result.reply, tools: result.tools }]);
      const history = await api<{ conversations: Conversation[] }>("/v1/conversations");
      setConversations(history.conversations);
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
    <section className="chat-page">
      <aside className="chat-list">
        <button className="button" type="button" onClick={newChat}>New chat</button>
        {conversations.map((item) => (
          <button key={item.id} type="button" className={item.id === conversationId ? "chat-item active" : "chat-item"} onClick={() => openConversation(item.id).catch((reason: Error) => setError(reason.message))}>
            {item.title}
          </button>
        ))}
        {conversations.length === 0 && <p className="empty">No chats yet.</p>}
      </aside>
      <div className="chat-main">
        <header className="chat-bar">
          <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
            <option value="">Select a model</option>
            {models.map((item) => (
              <option key={item.id} value={item.id}>{item.provider} · {item.model}</option>
            ))}
          </select>
          <button className="button ghost" type="button" onClick={() => setShowModels(true)}>Add model</button>
        </header>
        <div className="transcript" ref={thread}>
          {bubbles.length === 0 && (
            <div className="chat-empty">
              <h1>How can I help?</h1>
              <p>Ask about a connected app. Gmail, Calendar, Telegram, WhatsApp, and News are available once they are connected.</p>
            </div>
          )}
          {bubbles.map((bubble, index) => (
            <article key={`${bubble.role}-${index}`} className={bubble.failed ? "failed" : bubble.role}>
              <p>{bubble.content}</p>
              {bubble.tools && bubble.tools.length > 0 && <small>Used {bubble.tools.join(", ")}</small>}
            </article>
          ))}
          {sending && <article className="assistant pending">Thinking…</article>}
        </div>
        {error && <p className="banner error">{error}</p>}
        <form className="composer" onSubmit={(event) => send(event)}>
          <textarea
            rows={1}
            placeholder={selected ? "Message LoopAI" : "Add a model to start"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
          />
          <button className="button" type="submit" disabled={sending || !draft.trim()}>Send</button>
        </form>
        <p className="hint">Enter sends. Shift+Enter adds a line.</p>
      </div>
      {showModels && (
        <div className="modal-backdrop">
        <form className="modal" onSubmit={(event) => addModel(event).catch((reason: Error) => setError(reason.message))}>
          <h2>Add a model</h2>
          <label>
            Provider
            <select value={provider} onChange={(event) => pickProvider(event.target.value)}>
              {providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Model
            <input value={model} onChange={(event) => setModel(event.target.value)} required placeholder="gpt-4o-mini" />
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Required for a custom provider" />
          </label>
          <label>
            API key
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required minLength={8} autoComplete="off" />
          </label>
          <p className="empty">OpenAI, Gemini, Groq, and OpenRouter are built in. Any other host that speaks the OpenAI chat API goes in as Custom.</p>
          <div className="modal-actions">
            <button className="button ghost" type="button" onClick={() => setShowModels(false)}>Cancel</button>
            <button className="button" type="submit">Save model</button>
          </div>
        </form>
        </div>
      )}
    </section>
  );
}
