import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoginDialog } from "./Login";

const layers = [
  { title: "Gmail", detail: "One intro, from the account you connected.", shift: "sm:-rotate-6 sm:translate-y-3" },
  { title: "Jobs", detail: "Public listings for the role you typed.", shift: "z-10 sm:-translate-y-4 sm:scale-105" },
  { title: "Notes", detail: "Saved here, found again on the next prompt.", shift: "sm:rotate-6 sm:translate-y-3" },
];

export function Landing({ startOpen = false }: { startOpen?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(startOpen || location.pathname === "/login");

  function close() {
    setOpen(false);
    if (location.pathname === "/login") navigate("/", { replace: true });
  }

  return (
    <div className="min-h-dvh bg-stone-900 text-stone-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-orange-500 text-sm font-bold text-white">L</span>
          LoopAI
        </span>
        <div className="flex items-center gap-2">
          <button className="rounded-md px-3 py-2 text-sm" type="button" onClick={() => setOpen(true)}>Log in</button>
          <button className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-stone-900" type="button" onClick={() => setOpen(true)}>Get started</button>
        </div>
      </header>
      <section className="relative px-6 pb-24 pt-16">
        <div className="pointer-events-none absolute left-1/2 top-8 h-72 w-72 -translate-x-1/2 rounded-full bg-orange-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold tracking-[0.2em] text-orange-300">ON THIS COMPUTER</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight">Give your model a way to act</h1>
          <p className="mx-auto mt-4 max-w-xl text-stone-300">Connect Gmail, search public jobs, keep notes, and download the result. The keys stay in the vault on this machine.</p>
          <div className="mt-8 flex justify-center gap-3">
            <button className="rounded-md bg-white px-4 py-2 font-semibold text-stone-900" type="button" onClick={() => setOpen(true)}>Get started</button>
            <button className="rounded-md border border-stone-500 px-4 py-2" type="button" onClick={() => setOpen(true)}>Log in</button>
          </div>
        </div>
        <div className="relative mx-auto mt-16 grid max-w-3xl place-items-center [perspective:900px]">
          <div className="grid w-full gap-4 sm:grid-cols-3">
            {layers.map((layer) => (
              <article key={layer.title} className={`rounded-2xl border border-stone-700 bg-stone-800/90 p-5 shadow-2xl shadow-black/40 ${layer.shift} transition duration-300 hover:-translate-y-2 hover:rotate-0`}>
                <h2 className="text-lg font-semibold">{layer.title}</h2>
                <p className="mt-2 text-sm text-stone-300">{layer.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-stone-100 px-6 py-20 text-stone-900">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight">From a prompt to a finished file</h2>
          <p className="mt-3 text-stone-600">Ask in chat. The model calls the tool. You download PDF, Word, or Excel.</p>
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-3">
          {[
            ["Connect", "OAuth stays off until the client id and secret are in the API environment."],
            ["Ask", "Chat uses the Groq model you saved, or any OpenAI-compatible host."],
            ["Keep", "Notes and chapters stay in this workspace for the next prompt."],
          ].map(([title, detail]) => (
            <article key={title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-stone-600">{detail}</p>
            </article>
          ))}
        </div>
      </section>
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
            <LoginDialog onClose={close} />
          </div>
        </div>
      )}
    </div>
  );
}
