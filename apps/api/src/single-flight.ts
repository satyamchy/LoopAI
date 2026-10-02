const flights = new Map<string, Promise<unknown>>();

/** One refresh at a time per account, so two chats cannot rotate the same token. */
export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;
  const pending = run().finally(() => flights.delete(key));
  flights.set(key, pending);
  return pending;
}
