<!-- Fixing the starter or create-forkable? Delete the template sections and
     say what changed and how you checked it. -->

## What this is

<!-- One or two lines. For a template: what the business does, who it is for. -->

## New template

- Template id (`create-forkable/templates/<id>/`):
- Forked from (`forkedFrom` in forkable.json):
- Platforms it connects:
- Screenshot:

## Checklist

See [CONTRIBUTING.md](../CONTRIBUTING.md#3-what-a-template-must-have).

- [ ] `npm start` (or `pnpm start`) runs the keyless demo with no `.env` and exits 0
- [ ] `npm run typecheck` passes
- [ ] `connect.manifest.json` matches every `runAction` call, each with `access` and a `reason`
- [ ] Access is the narrowest that does the job
- [ ] The demo still ends on a declined action and its 403 receipt
- [ ] No secrets, keys, tokens or `.env` anywhere, including git history
- [ ] Sample data is Acme Inc only
- [ ] `AGENTS.md`, `agents/*.md`, `gtm/positioning.md`, `local/profile.md`, `forkable.json` describe this business
- [ ] MIT, with a `LICENSE` file
- [ ] `node create-forkable/bin/create-forkable.mjs try-it --template <id>` forks it cleanly
