import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type SessionUser } from "../api";
import { workspaceHome } from "../paths";

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Google sign-in did not finish. Check the redirect URL on the Google app." : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ google: boolean }>("/v1/auth/config").then((body) => setGoogle(body.google)).catch((reason: Error) => setError(reason.message));
    const code = params.get("code");
    if (!code) return;
    api<SessionUser>("/v1/auth/google/finish", { method: "POST", body: JSON.stringify({ code }) })
      .then((user) => { window.location.assign(`${workspaceHome(user.username)}/connect/clients/chatgpt`); })
      .catch((reason: Error) => setError(reason.message));
  }, [params]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api<SessionUser>(`/v1/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.assign(`${workspaceHome(user.username)}/connect/clients/chatgpt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setBusy(false);
    }
  }

  async function startGoogle() {
    setError(null);
    try {
      const started = await api<{ url: string }>("/v1/auth/google");
      window.location.href = started.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in is not configured.");
    }
  }

  return (
    <form className="grid w-full max-w-md gap-3 rounded-lg border border-stone-200 bg-white p-6 text-stone-900 shadow-2xl" onSubmit={submit}>
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-orange-500 font-bold text-white">L</span>
        <button className="text-sm text-stone-500" type="button" onClick={onClose}>Close</button>
      </div>
      <h1 className="text-2xl font-semibold">{mode === "login" ? "Sign in to LoopAI" : "Create your account"}</h1>
      <p className="text-stone-600">Username and password, or Google. The dashboard stays on this browser session.</p>
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      <label className="grid gap-1 text-sm">
        Username
        <input className="rounded-none border border-stone-300 bg-white px-2.5 py-2 text-stone-900" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} />
      </label>
      <label className="grid gap-1 text-sm">
        Password
        <input className="rounded-none border border-stone-300 bg-white px-2.5 py-2 text-stone-900" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
      </label>
      <button className="rounded-md bg-orange-500 px-3 py-2 font-semibold text-white disabled:bg-stone-300" type="submit" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
      <button className="rounded-md border border-stone-300 bg-white px-3 py-2" type="button" disabled={busy} onClick={startGoogle}>Continue with Google</button>
      {!google && <p className="text-sm text-stone-500">Google stays off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set, and the Google app allows http://localhost:8787/v1/auth/google/callback.</p>}
      <button className="text-left text-sm text-stone-500" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
