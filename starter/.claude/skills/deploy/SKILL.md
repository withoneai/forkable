---
name: deploy
description: Deploy this fork once it has its own Connect app and domain. Use only when the founder explicitly asks to go live; never deploy on your own initiative.
---

# deploy

Deploying is outward-facing and hard to reverse. Only run this when the
founder has asked, in this conversation, to deploy.

1. Confirm `connect.manifest.json` matches the code (same check as
   `add-integration` step 6) and that the keyless demo still exits 0.
2. Confirm the founder has made a Connect app in the One dashboard and set
   `ONE_CLIENT_ID`, `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY`,
   `ONE_REDIRECT_URI` through the guided env-var setup, not by hand-editing
   `.env` or pasting a secret into chat.
3. Deploy to the target this fork is set up for (Cloudflare Workers is the
   default for anything built on the orez.sh recipe; Vercel if this fork
   came out of the builder). Follow that platform's own skill
   (`cloudflare`/`wrangler`) for the actual deploy steps.
4. After deploying, confirm the redirect URI registered on the Connect app
   matches the live URL exactly.

Never deploy with a secret committed to the repo, and never deploy before
the founder has asked for this specific deploy.
