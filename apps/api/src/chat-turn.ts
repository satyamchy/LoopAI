import { secretStrings, type Toolkit } from "@loopai/core";
import { performExecute } from "./execute-request";
import { ApprovalRequired, providerBaseUrl, runToolLoop, selectTools, type ToolDef } from "./run-tool-loop";
import type { Store } from "./store";

type Deps = {
  store: Store;
  toolkits: Toolkit[];
  fetchImpl?: typeof fetch;
};

type Binding = { toolkit: string; action: string; connectedAccountId: string | null };

export async function runChat(
  deps: Deps,
  workspaceId: string,
  body: { message?: unknown; llmConnectionId?: unknown; conversationId?: unknown },
  onDelta?: (text: string) => void,
): Promise<{ http: number; body: Record<string, unknown> }> {
  if (typeof body.message !== "string" || !body.message.trim()) return { http: 400, body: { error: "Message is required." } };
  const llm = await deps.store.getLlm(String(body.llmConnectionId ?? ""));
  if (!llm || !(await deps.store.listLlms(workspaceId)).some((item) => item.id === llm.id)) {
    return { http: 400, body: { error: "Connect a model first." } };
  }
  const decrypted = (await deps.store.decrypt(workspaceId, llm.encryptedApiKey)) as { apiKey?: string };
  if (!decrypted.apiKey) return { http: 400, body: { error: "The model key could not be read." } };
  const accounts = await deps.store.listAccounts(workspaceId);
  const secrets = [decrypted.apiKey];
  for (const account of accounts) {
    const row = await deps.store.getAccount(account.id);
    if (row) secrets.push(...secretStrings(await deps.store.decrypt(workspaceId, row.encryptedCredentials)));
  }
  const bindings = bindTools(deps.toolkits, accounts);
  const selected = selectTools(body.message, bindings.tools);
  const downloads: { id: string; tool: string; tabular: boolean }[] = [];
  const requested = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
  const conversationId = requested ?? (await deps.store.createConversation(workspaceId, body.message.slice(0, 80))).id;
  const conversation = await deps.store.getConversation(conversationId);
  if (!conversation || conversation.workspaceId !== workspaceId) return { http: 404, body: { error: "Conversation not found." } };
  await deps.store.insertMessage(conversationId, "user", body.message);
  const history = await deps.store.listMessages(conversationId);
  try {
    const result = await runToolLoop({
      endpoint: `${providerBaseUrl(llm.provider, llm.baseUrl)}/chat/completions`,
      apiKey: decrypted.apiKey,
      model: llm.model,
      history,
      tools: selected,
      catalog: bindings.tools,
      fetchImpl: deps.fetchImpl ?? fetch,
      secrets,
      onDelta,
      callTool: (name, args) => callBound(deps, workspaceId, conversationId, bindings.byName, name, args, downloads, false),
    });
    if (result.pending) {
      await deps.store.insertMessage(conversationId, "assistant", `Waiting for confirmation: ${result.pending.summary}`);
      return { http: 200, body: { conversationId, reply: `Confirm ${result.pending.summary}?`, tools: result.toolsUsed, downloads, pending: result.pending } };
    }
    const reply = redactText(result.text, secrets);
    await deps.store.insertMessage(conversationId, "assistant", reply);
    return { http: 200, body: { conversationId, reply, tools: result.toolsUsed, downloads } };
  } catch (error) {
    const safe = redactText(error instanceof Error ? error.message : "Chat failed", secrets).slice(0, 300);
    await deps.store.insertMessage(conversationId, "assistant", safe);
    return { http: 502, body: { error: safe, conversationId } };
  }
}

export async function confirmChat(
  deps: Deps,
  workspaceId: string,
  body: { approvalId?: unknown; accept?: unknown; llmConnectionId?: unknown },
  onDelta?: (text: string) => void,
): Promise<{ http: number; body: Record<string, unknown> }> {
  const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
  const approval = approvalId ? await deps.store.getApproval(workspaceId, approvalId) : null;
  if (!approval || approval.status !== "pending") return { http: 404, body: { error: "That approval was not found." } };
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    await deps.store.setApprovalStatus(approval.id, "expired");
    return { http: 400, body: { error: "That approval has expired." } };
  }
  const accept = body.accept === true;
  await deps.store.setApprovalStatus(approval.id, accept ? "accepted" : "cancelled");
  if (!accept) {
    if (approval.conversationId && body.llmConnectionId) {
      return finish(deps, workspaceId, approval.conversationId, String(body.llmConnectionId), "The user cancelled that action. Do not send it.", onDelta);
    }
    return { http: 200, body: { status: "cancelled", approvalId: approval.id } };
  }
  const args = await deps.store.decrypt(workspaceId, approval.argsEncrypted);
  const outcome = await performExecute(deps, {
    workspaceId,
    toolkit: approval.toolkitSlug,
    action: approval.action,
    args,
    connectedAccountId: approval.connectedAccountId,
    confirmed: true,
    conversationId: approval.conversationId,
  });
  if (!approval.conversationId || !body.llmConnectionId) return outcome;
  const note = outcome.http >= 400 ? `The tool failed: ${String(outcome.body.error ?? "Tool failed")}` : `The confirmed tool returned: ${JSON.stringify(outcome.body.result)}`;
  return finish(deps, workspaceId, approval.conversationId, String(body.llmConnectionId), note, onDelta, [approval.toolkitSlug]);
}

async function finish(deps: Deps, workspaceId: string, conversationId: string, llmConnectionId: string, note: string, onDelta?: (text: string) => void, tools: string[] = []): Promise<{ http: number; body: Record<string, unknown> }> {
  await deps.store.insertMessage(conversationId, "user", note);
  const llm = await deps.store.getLlm(llmConnectionId);
  if (!llm) return { http: 400, body: { error: "Connect a model first.", conversationId } };
  const decrypted = (await deps.store.decrypt(workspaceId, llm.encryptedApiKey)) as { apiKey?: string };
  if (!decrypted.apiKey) return { http: 400, body: { error: "The model key could not be read." } };
  const history = await deps.store.listMessages(conversationId);
  const result = await runToolLoop({
    endpoint: `${providerBaseUrl(llm.provider, llm.baseUrl)}/chat/completions`,
    apiKey: decrypted.apiKey,
    model: llm.model,
    history,
    tools: [],
    fetchImpl: deps.fetchImpl ?? fetch,
    secrets: [decrypted.apiKey],
    onDelta,
    callTool: async () => {
      throw new Error("No further tools.");
    },
  });
  const reply = redactText(result.text, [decrypted.apiKey]);
  await deps.store.insertMessage(conversationId, "assistant", reply);
  return { http: 200, body: { conversationId, reply, tools } };
}

async function callBound(
  deps: Deps,
  workspaceId: string,
  conversationId: string,
  byName: Map<string, Binding>,
  name: string,
  args: unknown,
  downloads: { id: string; tool: string; tabular: boolean }[],
  confirmed: boolean,
): Promise<unknown> {
  const binding = byName.get(name);
  if (!binding) throw new Error(`Unknown tool ${name}`);
  const outcome = await performExecute(deps, { workspaceId, ...binding, args, confirmed, conversationId });
  if (outcome.body.status === "pending" && typeof outcome.body.approvalId === "string") {
    throw new ApprovalRequired({
      id: outcome.body.approvalId,
      summary: String(outcome.body.summary ?? binding.action),
      toolkit: binding.toolkit,
      action: binding.action,
    });
  }
  if (outcome.http >= 400) throw new Error(String(outcome.body.error ?? "Tool failed"));
  if (typeof outcome.body.id === "string") {
    const { tableFromResult } = await import("./export-file");
    downloads.push({ id: outcome.body.id, tool: binding.toolkit, tabular: tableFromResult(outcome.body.result) !== null });
  }
  return outcome.body.result;
}

function bindTools(toolkits: Toolkit[], accounts: { id: string; toolkitSlug: string; status: string; externalLabel: string | null }[]) {
  const byName = new Map<string, Binding>();
  const tools: ToolDef[] = [];
  for (const toolkit of toolkits) {
    const rows = toolkit.authType === "none" ? [null] : accounts.filter((account) => account.toolkitSlug === toolkit.slug && account.status === "active");
    for (const account of rows) {
      for (const action of toolkit.actions) {
        const name = account ? `${toolkit.slug}__${action.slug}__${account.id.replace(/-/g, "").slice(0, 8)}` : `${toolkit.slug}__${action.slug}`;
        byName.set(name, { toolkit: toolkit.slug, action: action.slug, connectedAccountId: account?.id ?? null });
        tools.push({
          name,
          description: account?.externalLabel ? `${action.description} Account: ${account.externalLabel}.` : action.description,
          parameters: action.parameters,
        });
      }
    }
  }
  return { byName, tools };
}

function redactText(text: string, secrets: string[]): string {
  return secrets.filter((secret) => secret.length >= 8).reduce((current, secret) => current.split(secret).join("[redacted]"), text);
}
