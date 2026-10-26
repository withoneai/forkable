import { Hono } from "hono";
import { loadEnv, hasOneConnectConfig } from "./env.js";
import { createOneConnectClient, mountConnectRoutes } from "./connect.js";
import { loadFixture, runHelloAgent } from "./hello-agent.js";
import type { AppEnv } from "./server-env.js";

export function createApp() {
  const env = loadEnv();
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ ok: true, connect: hasOneConnectConfig(env) }));

  mountConnectRoutes(app, createOneConnectClient(env));

  // The sample route, so the app has something to show before a fork adds
  // its own. Swap this for the hello agent's real action once One Connect
  // is configured (see agents/hello.md).
  app.get("/api/hello", (c) => {
    const { messages, receipt } = runHelloAgent(loadFixture());
    return c.json({ messages, receipt, connected: hasOneConnectConfig(env) });
  });

  return { app, env };
}
