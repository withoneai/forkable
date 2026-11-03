# Replay scenarios

Scripted turns for the `replay` harness (`packages/harness/src/adapters/replay.ts`),
used by `pnpm start`, tests and UI work. Nothing
is spawned and nothing touches the network.

```json
{ "turns": [ { "match": "optional substring of the prompt",
               "events": [ HarnessEvent ],
               "writes": [ { "path": "src/App.tsx", "content": "..." } ],
               "delete": [ "src/old.ts" ],
               "delayMs": 40,
               "exit": "error", "error": "only for tests" } ] }
```

- Which turn plays: `input.replay.index` when given; else the first turn whose
  `match` appears in the prompt (case-insensitive); else the next turn by a
  counter kept in `<stateDir>/replay-<scenario>.json`.
- A `session` event comes first (the input's session id, or `replay-<uuid>`);
  `session` events inside the file are skipped.
- `writes` and `delete` land just before the last event, so a file watcher sees
  them while the turn is still running. Paths are project-relative and may
  not leave the project.
- Pause between events is `delayMs * input.replay.speed` (default 40 ms, speed
  0 for tests).
- `text_delta` streams the block being written; `text` is the finished block
  and replaces the deltas before it.
