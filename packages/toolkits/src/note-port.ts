export type NoteKind = "note" | "chapter" | "application";
export type SavedNote = { id: string; title: string; body: string };

/** The API attaches this to credentials. Toolkits do not open the database. */
export type NotePort = {
  save(input: { kind: NoteKind; title: string; body: string }): Promise<SavedNote>;
  search(kind: NoteKind, query: string): Promise<SavedNote[]>;
  list(kind: NoteKind): Promise<SavedNote[]>;
  read(id: string): Promise<(SavedNote & { kind: string }) | null>;
  append(id: string, text: string): Promise<SavedNote | null>;
};

export function notePortFrom(credentials: Record<string, unknown> | undefined): NotePort {
  const port = credentials?.notePort;
  if (!port || typeof port !== "object") throw new Error("Notes are not available.");
  return port as NotePort;
}
