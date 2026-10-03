import { useEffect, useState } from "react";
import { api } from "../api";

type Row = { id: string; toolkitSlug: string; action: string; status: string; errorCode: string | null; createdAt: string };

export function Activity() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ executions: Row[] }>("/v1/executions")
      .then((body) => setRows(body.executions))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <section className="mx-auto grid max-w-3xl gap-4">
      <header>
        <h1 className="text-3xl font-semibold">Activity</h1>
        <p className="mt-1 text-stone-400">Recent tool runs in this workspace. Secrets are already removed.</p>
      </header>
      {error && <p className="border border-red-900 bg-red-950 px-3 py-2">{error}</p>}
      {rows.length === 0 && !error && <p className="text-stone-400">No tool runs yet.</p>}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-sm">
            <strong>{row.toolkitSlug}</strong> {row.action}
            <span className="text-stone-400"> · {row.status}</span>
            <div className="text-xs text-stone-500">{new Date(row.createdAt).toLocaleString()}</div>
            {row.errorCode && <p className="mt-1 text-red-300">{row.errorCode}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
