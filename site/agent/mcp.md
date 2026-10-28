<!-- MCP_HEADLINE: keep this H1 in step with src/components/mcp/McpPage.tsx. -->
# Apps inside your chat

Ask your chat for an app. It builds it right there, on your own accounts, then keeps it so you can open it again tomorrow.

Connector URL, for Claude or ChatGPT (add it as a custom connector):

```
https://blocks.forkable.dev/mcp
```

<!-- RUN_HEADLINE: keep this H2 in step with src/components/mcp/RunYourOwn.tsx. -->
## Run your own MCP

The code behind blocks.forkable.dev is open source (MIT): `mcp/` in https://github.com/withoneai/forkable. Fork it and you have an MCP server on your own domain, under your own brand, with Sign in with One as its login. Each of your users connects their own accounts, from any of the {{PLATFORM_COUNT}} apps in One's catalog, and every tool call runs on that person's grant, not a shared key.

- **One Cloudflare Worker.** The MCP endpoint, its own OAuth server (dynamic client registration and PKCE) and the website. Claude and ChatGPT add it directly.
- **Runs on the Acme Inc sample with no keys**, before you make anything in One.
- **A starting point for any MCP** that should act on each person's own accounts. Keep the UI tools or swap them; tools live in `src/mcp.ts` and `src/tools.ts`.

Steps (full detail in the README, https://github.com/withoneai/forkable/tree/main/mcp#run-it-on-the-sample):

1. **Run it on the sample.**
   ```bash
   git clone https://github.com/withoneai/forkable.git
   cd forkable/mcp && pnpm install
   cp .dev.vars.example .dev.vars
   pnpm dev    # http://localhost:52290, Acme Inc sample, no keys
   ```
2. **Make one Connect app** in the One dashboard (Developers, Connect, New app) with the redirect URI `https://<your-host>/api/one/callback`. It is your MCP's login and decides which tools people can connect.
3. **Deploy.** Put the client id, client secret and Connect key in as Worker secrets (`npx wrangler secret put ...`), then `pnpm deploy` (builds the views, applies the D1 migration, runs `wrangler deploy`).
4. **Add it to Claude or ChatGPT** as a custom connector: `https://<your-host>/mcp`.

Making the Connect app is a dashboard step; there is no command for it in this repo yet.

## How it works

1. **Add one URL.** In Claude or ChatGPT, add `https://blocks.forkable.dev/mcp` as a custom connector. Sign in with One and pick the accounts it may use.
2. **Ask for a screen.** Say what you want to see. The agent finds the actions on your accounts, writes the UI and runs it in the chat.
3. **Keep it.** Every UI is saved with its versions. Open it again in either chat app, or on the web at https://blocks.forkable.dev.

Reads run at once. Every write (send, create, archive) stops at a Confirm the UI itself cannot press. Secured by One: you connect your own accounts and can revoke them any time.

## Six apps worth asking for

Each one is a single prompt. The UI each one renders is a TSX file in the Forkable repo (`site/src/flows/<id>.tsx`), written against the kit the MCP gives every UI. On forkable.dev/mcp they run on the Acme Inc sample.

{{FLOW_SECTIONS}}

## Under the hood

The MCP has {{TOOL_COUNT}} tools: {{TOOL_LIST}}. The screens it writes import one small React kit (`@forkable/ui`), so every UI looks right in light and dark. It works with any of the {{PLATFORM_COUNT}} apps in One's catalog.

- Code: https://github.com/withoneai/forkable/tree/main/mcp
- Your saved UIs: https://blocks.forkable.dev
- Want the whole app in your own repo instead? Fork the business it came from: https://forkable.dev/
