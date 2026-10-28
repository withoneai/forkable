-- Saved UIs the agent writes. One row per UI, one row per version.
-- owner is the person's One id (cu_...), the same in every chat app.
CREATE TABLE uis (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL,
  saved INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX uis_owner ON uis (owner, deleted, saved, updated_at DESC);

-- Versions never change once written. actions is JSON: the declared One
-- actions with method, path and whether each is a write.
CREATE TABLE ui_versions (
  id TEXT PRIMARY KEY,
  ui_id TEXT NOT NULL REFERENCES uis(id),
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  js TEXT NOT NULL,
  actions TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ui_id, version)
);
