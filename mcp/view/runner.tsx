import "@tailwindcss/browser";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { Component, StrictMode, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { onShellMessage, post } from "./runner-bridge";
import * as kit from "./kit";
import { icons } from "./icons";

// Runs the agent's module, sandboxed, inside the shell. The module arrives
// from the shell as compiled JS and goes into an inline <script> (no eval).


const MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-dom": ReactDOM,
  "@forkable/ui": kit,
  "lucide-react": icons,
  clsx: { default: kit.cn, clsx: kit.cn },
};

function load(js: string): Promise<ComponentType> {
  return new Promise((resolve, reject) => {
    (window as any).__forkableDefine = (factory: (require: (m: string) => unknown, module: { exports: any }, exports: any) => void) => {
      try {
        const module = { exports: {} as any };
        factory(
          (name) => {
            if (name in MODULES) return MODULES[name];
            throw new Error(`Cannot import "${name}" here. Allowed: ${Object.keys(MODULES).join(", ")}.`);
          },
          module,
          module.exports,
        );
        const C = module.exports.default ?? module.exports;
        typeof C === "function" ? resolve(C) : reject(new Error("The module has no default-exported component."));
      } catch (e) {
        reject(e);
      }
    };
    const onErr = (ev: ErrorEvent) => reject(ev.error ?? new Error(ev.message));
    window.addEventListener("error", onErr, { once: true });
    const s = document.createElement("script");
    s.textContent = `window.__forkableDefine(function (require, module, exports) {\n${js}\n});`;
    document.body.appendChild(s);
    s.remove();
    window.removeEventListener("error", onErr);
  });
}

const fail = (e: unknown) => {
  const message = String((e as Error)?.message ?? e);
  post({ type: "error", message });
  return message;
};

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String((e as Error)?.message ?? e) };
  }
  componentDidCatch(e: unknown) {
    fail(e);
  }
  render() {
    return this.state.error ? <Failed message={this.state.error} /> : this.props.children;
  }
}

const Failed = ({ message }: { message: string }) => (
  <div className="flex flex-col gap-1.5 p-3 text-13">
    <span className="text-foreground">This UI hit an error</span>
    <span className="font-mono text-11 text-muted-foreground">{message}</span>
  </div>
);

function Runner() {
  const [ui, setUi] = useState<{ C: ComponentType } | { error: string } | null>(null);
  useEffect(() => {
    onShellMessage((msg) => {
      if (msg.type === "theme") document.documentElement.classList.toggle("dark", !!msg.dark);
      if (msg.type === "load") {
        document.documentElement.classList.toggle("dark", !!msg.dark);
        load(String(msg.js))
          .then((C) => setUi({ C }))
          .catch((e) => setUi({ error: fail(e) }));
      }
    });
    // Tell the shell our height so it can size this frame.
    const ro = new ResizeObserver(() => post({ type: "size", height: Math.ceil(document.documentElement.scrollHeight) }));
    ro.observe(document.documentElement);
    post({ type: "ready" });
    return () => ro.disconnect();
  }, []);
  if (!ui) return null;
  if ("error" in ui) return <Failed message={ui.error} />;
  const { C } = ui;
  return (
    <Boundary>
      <C />
    </Boundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Runner />
  </StrictMode>,
);
