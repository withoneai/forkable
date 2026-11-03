// Dev-only helper for the __BRAND_NAME__ preview. Small and vendored on purpose:
// an exported copy of this app needs no package of ours.
//
// 1. A Babel plugin that adds data-__BRAND_SLUG__-loc="src/App.tsx:42:8" to every
//    intrinsic JSX element (lowercase tag) under src/, so the preview can map
//    a click back to the line that wrote it. Components are not tagged; the
//    host elements they render carry the loc of where they are written.
// 2. A Vite plugin that reports build errors (transform, resolve, Worker) to
//    the platform, and a clear signal once an update applies again.
//
// Both are inert unless __ENV_PREFIX__PROJECT_ID is set, so outside the preview
// this is a plain Vite app.

import { relative, sep } from "node:path";
import type { PluginObj, types as BabelTypes } from "@babel/core";
import type { HMRPayload, Plugin } from "vite";

const P = "__ENV_PREFIX__";
const ATTR = "data-__BRAND_SLUG__-loc";

interface ErrorBody {
  source: "build" | "server";
  message: string;
  file?: string;
  line?: number;
  col?: number;
  stack?: string;
  clear?: boolean;
}

export function devTagger(options: { root: string }) {
  const env = process.env;
  const active = Boolean(env[`${P}PROJECT_ID`]);
  // The platform's dev check takes the build errors this plugin sees (CONTRACT 12).
  const relayUrl = env[`${P}DEV_URL`] ?? env[`${P}RELAY_URL`];
  const relayToken = env[`${P}DEV_TOKEN`] ?? env[`${P}RELAY_TOKEN`];
  const root = options.root;

  const rel = (file: string): string => {
    const clean = file.replace(/[?#].*$/, "");
    const r = relative(root, clean);
    return r.startsWith("..") ? clean : r.split(sep).join("/");
  };

  const babel = ({ types: t }: { types: typeof BabelTypes }): PluginObj => ({
    name: "__BRAND_SLUG__-jsx-loc",
    visitor: {
      JSXOpeningElement(path, state) {
        const filename = state.filename;
        if (!filename) return;
        const file = rel(filename);
        if (!file.startsWith("src/")) return;
        const name = path.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return;
        const has = path.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === ATTR,
        );
        if (has || !path.node.loc) return;
        const { line, column } = path.node.loc.start;
        path.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(ATTR), t.stringLiteral(`${file}:${line}:${column + 1}`)));
      },
    },
  });

  let last = "";
  let hadError = false;
  const post = (body: ErrorBody) => {
    if (!active || !relayUrl) return;
    const key = JSON.stringify(body);
    const sig = `${body.source}|${body.message}|${body.file}:${body.line}|${body.clear ?? false}`;
    if (sig === last) return;
    last = sig;
    hadError = !body.clear;
    fetch(`${relayUrl.replace(/\/$/, "")}/errors`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(relayToken ? { authorization: `Bearer ${relayToken}` } : {}) },
      body: key,
    }).catch(() => {
      /* the platform also reads the dev server's own output */
    });
  };

  // Vite logs carry ANSI colours, a timestamp prefix and absolute paths.
  const roots = [root, root.replace(/^\/private\//, "/"), `/private${root}`].map((r) => `${r.replace(/\/$/, "")}/`);
  const plain = (s: string) => {
    let out = s.replace(/\u001b\[[0-9;]*m/g, "").replace(/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?\s*/i, "");
    for (const r of roots) out = out.split(r).join("");
    return out.trim();
  };

  const fromError = (err: unknown, source: "build" | "server"): ErrorBody => {
    const e = (err ?? {}) as {
      message?: string;
      stack?: string;
      id?: string;
      loc?: { file?: string; line?: number; column?: number };
      frame?: string;
    };
    const file = e.loc?.file ?? e.id;
    return {
      source,
      message: plain(String(e.message ?? err)).slice(0, 4000),
      file: file ? rel(file) : undefined,
      line: e.loc?.line,
      col: e.loc?.column !== undefined ? e.loc.column + 1 : undefined,
      stack: e.stack ? plain(e.stack).slice(0, 4000) : undefined,
    };
  };

  const plugin: Plugin = {
    name: "__BRAND_SLUG__-dev-reporter",
    apply: "serve",
    configureServer(server) {
      if (!active) return;
      const logger = server.config.logger;
      const error = logger.error.bind(logger);
      logger.error = (msg, opts) => {
        if (opts?.error) post(fromError(opts.error, "build"));
        else post({ source: /worker|workerd|miniflare/i.test(msg) ? "server" : "build", message: plain(msg).slice(0, 4000) });
        error(msg, opts);
      };
      const send = server.ws.send.bind(server.ws) as (...args: unknown[]) => void;
      server.ws.send = ((...args: unknown[]) => {
        const payload = args[0] as HMRPayload | string;
        if (typeof payload === "object" && payload) {
          if (payload.type === "error") post(fromError(payload.err, "build"));
          else if ((payload.type === "update" || payload.type === "full-reload") && hadError) post({ source: "build", message: "", clear: true });
        }
        send(...args);
      }) as typeof server.ws.send;
    },
  };

  return { babel, plugin };
}
