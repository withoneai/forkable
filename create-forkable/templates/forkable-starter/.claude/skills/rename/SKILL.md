---
name: rename
description: Rewrite this fork's product name, package name, and sample copy after npm create forkable scaffolds it, or whenever the founder wants to rename it. Use before adding real business logic, so names are right from the start.
---

# rename

The founder gives a new name (and, optionally, a domain and an accent
color).

1. `package.json`: `name` field (keep it a valid npm package name:
   lowercase, hyphens, no spaces).
2. `forkable.json`: `name`.
3. `README.md` and `AGENTS.md`: every mention of "forkable-starter" or
   "Acme Inc" that refers to the product itself (keep "Acme Inc" as the
   sample company name in `fixtures/` and the demo output; that is the
   house convention every fork keeps, not something to rename).
4. `local/profile.md`: leave `{{FOR}}` / `{{IN}}` as already filled by
   `npm create forkable`'s `--for`/`--in`, or fill them in now if they are
   still placeholders.
5. If this fork has a `site/` or `brand/` folder, hand off to the
   `forkable-letter-mark` skill for a new logo and the site's rename pass.

Never rename the sample company in `fixtures/` to a real company, and
never put a real customer or prospect name anywhere in the repo.
