import { Link } from "react-router-dom";
import { useBase } from "../paths";

export function Help() {
  const base = useBase();
  return (
    <section className="mx-auto grid max-w-3xl gap-4">
      <header>
        <h1 className="text-3xl font-semibold">Help</h1>
        <p className="mt-1 text-stone-500">What this workspace can and cannot do today.</p>
      </header>
      <article className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-base font-semibold">Sign-in</h2>
        <p className="mt-1 text-stone-600">Username and password stay in this database. Google uses the same client id as Gmail. Add <code>http://localhost:8787/v1/auth/google/callback</code> as a redirect URL before Continue with Google will return here.</p>
      </article>
      <article className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-base font-semibold">One workspace</h2>
        <p className="mt-1 text-stone-600">A login names you. It does not yet give you a private vault. Every signed-in user of this server still shares the connected apps.</p>
      </article>
      <article className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-base font-semibold">Check the app after a change</h2>
        <p className="mt-1 text-stone-600">From the repo folder, run <code>corepack pnpm test</code>. That checks the Groq model name, the intro email (including the failure when Gmail is not connected), notes, job search, manuscript chapters, and PDF, Word, and Excel download. It does not call Groq and it does not send a real email.</p>
        <p className="mt-2 text-stone-600">To also call Groq and the public job boards, put <code>GROQ_API_KEY</code> in <code>apps/api/.env</code> and run <code>corepack pnpm test:live</code>. Restart the API after changing that file so Chat picks up the saved model.</p>
      </article>
      <article className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-base font-semibold">Chat</h2>
        <p className="mt-1 text-stone-600">The model can call tools for four rounds, then it stops. Older than the last 20 messages drops out of the prompt. A reply can be downloaded as PDF, Word, or Excel. A table result can be downloaded in those formats too.</p>
        <p className="mt-2"><Link className="text-orange-700" to={`${base}/chat`}>Open chat</Link></p>
      </article>
    </section>
  );
}
