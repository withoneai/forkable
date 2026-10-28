import type { DeclaredAction } from "./generative.js";

// Saved UIs in D1. A render is one version of one UI; its id (the version
// row id) is what the canvas sends back with every run_action, and the
// server checks it belongs to the caller before running anything.

export interface UiRow {
  id: string;
  owner: string;
  title: string;
  description: string;
  current_version: number;
  saved: number;
  created_at: number;
  updated_at: number;
}

export interface VersionRow {
  id: string;
  ui_id: string;
  version: number;
  source: string;
  js: string;
  actions: string;
  created_at: number;
}

export interface Render {
  renderId: string;
  uiId: string;
  version: number;
  owner: string;
  title: string;
  description: string;
  js: string;
  actions: DeclaredAction[];
  saved: boolean;
}

const toRender = (u: UiRow, v: VersionRow): Render => ({
  renderId: v.id,
  uiId: u.id,
  version: v.version,
  owner: u.owner,
  title: u.title,
  description: u.description,
  js: v.js,
  actions: JSON.parse(v.actions) as DeclaredAction[],
  saved: !!u.saved,
});

export async function createUi(
  db: D1Database,
  input: { owner: string; title: string; description: string; source: string; js: string; actions: DeclaredAction[]; saved: boolean },
): Promise<Render> {
  const now = Date.now();
  const uiId = `ui_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const versionId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO uis (id, owner, title, description, current_version, saved, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
      .bind(uiId, input.owner, input.title, input.description, input.saved ? 1 : 0, now, now),
    db
      .prepare("INSERT INTO ui_versions (id, ui_id, version, source, js, actions, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)")
      .bind(versionId, uiId, input.source, input.js, JSON.stringify(input.actions), now),
  ]);
  return { renderId: versionId, uiId, version: 1, owner: input.owner, title: input.title, description: input.description, js: input.js, actions: input.actions, saved: input.saved };
}

export async function addVersion(
  db: D1Database,
  owner: string,
  uiId: string,
  input: { source: string; js: string; actions: DeclaredAction[]; title?: string; description?: string },
): Promise<Render | null> {
  const ui = await getUi(db, owner, uiId);
  if (!ui) return null;
  const now = Date.now();
  const version = ui.current_version + 1;
  const versionId = crypto.randomUUID();
  const title = input.title?.trim() || ui.title;
  const description = input.description ?? ui.description;
  await db.batch([
    db
      .prepare("INSERT INTO ui_versions (id, ui_id, version, source, js, actions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(versionId, uiId, version, input.source, input.js, JSON.stringify(input.actions), now),
    db.prepare("UPDATE uis SET current_version = ?, title = ?, description = ?, saved = 1, updated_at = ? WHERE id = ?").bind(version, title, description, now, uiId),
  ]);
  return { renderId: versionId, uiId, version, owner, title, description, js: input.js, actions: input.actions, saved: true };
}

export async function getUi(db: D1Database, owner: string, uiId: string): Promise<UiRow | null> {
  return db.prepare("SELECT * FROM uis WHERE id = ? AND owner = ? AND deleted = 0").bind(uiId, owner).first<UiRow>();
}

export async function loadRender(db: D1Database, owner: string, uiId: string, version?: number): Promise<Render | null> {
  const ui = await getUi(db, owner, uiId);
  if (!ui) return null;
  const v = await db
    .prepare("SELECT * FROM ui_versions WHERE ui_id = ? AND version = ?")
    .bind(uiId, version ?? ui.current_version)
    .first<VersionRow>();
  return v ? toRender(ui, v) : null;
}

/** The render a run_action names, only if it belongs to `owner`. */
export async function renderById(db: D1Database, owner: string, renderId: string): Promise<Render | null> {
  const row = await db
    .prepare(
      "SELECT u.id AS u_id, u.owner, u.title, u.description, u.current_version, u.saved, u.created_at AS u_created, u.updated_at, v.* FROM ui_versions v JOIN uis u ON u.id = v.ui_id WHERE v.id = ? AND u.owner = ? AND u.deleted = 0",
    )
    .bind(renderId, owner)
    .first<Record<string, any>>();
  if (!row) return null;
  return toRender(
    { id: row.u_id, owner: row.owner, title: row.title, description: row.description, current_version: row.current_version, saved: row.saved, created_at: row.u_created, updated_at: row.updated_at },
    row as unknown as VersionRow,
  );
}

export async function listUis(db: D1Database, owner: string, query = "") {
  const q = `%${query.trim().toLowerCase()}%`;
  const { results } = await db
    .prepare(
      "SELECT u.id, u.title, u.description, u.current_version, u.created_at, u.updated_at, v.actions FROM uis u JOIN ui_versions v ON v.ui_id = u.id AND v.version = u.current_version WHERE u.owner = ? AND u.deleted = 0 AND u.saved = 1 AND (lower(u.title) LIKE ? OR lower(u.description) LIKE ?) ORDER BY u.updated_at DESC LIMIT 100",
    )
    .bind(owner, q, q)
    .all<{ id: string; title: string; description: string; current_version: number; created_at: number; updated_at: number; actions: string }>();
  return results.map((r) => ({ ...r, actions: JSON.parse(r.actions) as DeclaredAction[] }));
}

export async function listVersions(db: D1Database, owner: string, uiId: string) {
  if (!(await getUi(db, owner, uiId))) return [];
  const { results } = await db.prepare("SELECT version, created_at FROM ui_versions WHERE ui_id = ? ORDER BY version DESC").bind(uiId).all<{ version: number; created_at: number }>();
  return results;
}

export async function renameUi(db: D1Database, owner: string, uiId: string, title: string, description?: string) {
  const r = await db
    .prepare("UPDATE uis SET title = ?, description = COALESCE(?, description), saved = 1, updated_at = ? WHERE id = ? AND owner = ? AND deleted = 0")
    .bind(title, description ?? null, Date.now(), uiId, owner)
    .run();
  return r.meta.changes > 0;
}

export async function deleteUi(db: D1Database, owner: string, uiId: string) {
  const r = await db.prepare("UPDATE uis SET deleted = 1, updated_at = ? WHERE id = ? AND owner = ? AND deleted = 0").bind(Date.now(), uiId, owner).run();
  return r.meta.changes > 0;
}
