import { randomBytes } from "node:crypto";

type RequestApp = {
  request: (input: string, init?: RequestInit) => Promise<Response> | Response;
};

/** Sign up once and attach the session cookie to later requests. */
export async function withSession<T extends RequestApp>(app: T): Promise<T> {
  const username = `u${randomBytes(4).toString("hex")}`;
  const registered = await app.request("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "password-ok" }),
  });
  if (registered.status !== 200) throw new Error(await registered.text());
  const cookie = (registered.headers.get("set-cookie") ?? "").split(";")[0];
  const request = app.request.bind(app);
  return Object.assign(app, {
    request(input: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("cookie") && !headers.has("authorization")) headers.set("cookie", cookie);
      return Promise.resolve(request(input, { ...init, headers }));
    },
  });
}
