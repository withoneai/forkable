// The Node.js function wrapper tools/build-vercel.mjs bundles around
// api/index.ts: a Node request in, a Web Request to the Hono app, the
// Response written back (every Set-Cookie kept).

import handler from "../api/index.ts";

export default async function vercelNode(req, res) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost");
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, String(v));
  }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    body = Buffer.concat(chunks);
  }
  const response = await handler(new Request(`${proto}://${host}${req.url ?? "/"}`, { method: req.method, headers, body }));
  res.statusCode = response.status;
  const cookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((v, k) => {
    if (k !== "set-cookie") res.setHeader(k, v);
  });
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
