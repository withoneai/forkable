// The CLI's side of the REST API: the token file (~/.search/cli-token.json, 0600),
// bearer requests with one refresh on 401, and the exit codes from SPEC 16.3.

import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect, type Socket } from "node:net";
import { appendFileSync, chmodSync, closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const EXIT = { ok: 0, error: 1, usage: 2, notSignedIn: 3, notRunning: 4 } as const;
export const DEFAULT_SERVER = "http://localhost:52289";
export const ALL_SCOPES = ["search:read", "search:ask", "sources:write", "account:read"];

export class CliError extends Error {
  constructor(message: string, public readonly exit: number = EXIT.error) { super(message); }
}

export interface TokenFile { server: string; clientId: string; accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] }

export const home = () => resolve(process.env.SEARCH_HOME || resolve(homedir(), ".search"));
let tokenName: string | null = null;
/**
 * Use an agent's own sign-in instead of the CLI's (`search mcp --as claude-desktop`):
 * SEARCH_HOME/agents/<name>-token.json, so the agent shows up and signs out on its own.
 */
export function useAgentToken(name: string | null): void {
  if (name && !/^[a-z0-9-]{1,40}$/.test(name)) throw new CliError(`--as takes a short name like claude-desktop, not ${name}.`, EXIT.usage);
  tokenName = name;
}
export const tokenPath = () => (tokenName ? resolve(home(), "agents", `${tokenName}-token.json`) : resolve(home(), "cli-token.json"));

export function readToken(): TokenFile | null {
  const p = tokenPath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as TokenFile; } catch { return null; }
}

/** Atomic: a temp file in the same folder, then rename, so a reader never sees half a file. */
export function writeToken(t: TokenFile): void {
  const p = tokenPath();
  guardFs(p, () => {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(t, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, p);
  });
}

// ---------- one refresh at a time across processes ----------
//
// Every bridge and CLI process that shares a token file refreshes under
// <token file>.lock and re-reads the file first, so a pair another process just
// refreshed is used instead of presenting a spent refresh token. A lock whose
// process is gone, or that is older than LOCK_STALE_MS, is taken over. A refresh
// that dies after the server rotated but before the file was written is covered by
// the server's short grace for a just-rotated token (server/src/oauth.ts).
//
// A process can also be paused in the middle (laptop sleep, SIGSTOP, a debugger) and
// wake up long after. So after ANY await in a refresh (an answer, a timeout, an
// error) it takes the lock back if it lost it and re-reads the file before it does
// anything else: it presents a refresh token only while the file still holds that
// exact token, and saves an answer only while it holds the lock and the file still
// holds the token it spent. Timeouts count only time the process was awake, so a
// bridge that wakes in the morning reads the answer that waited in its socket instead
// of giving up on it at once and asking again past the server's grace.

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 40_000;
/** Another process may finish a refresh someone else started only this soon after it was sent: under the server's 30 s grace, with room for a slow answer. */
const TAKEOVER_MS = 20_000;
export const REFRESH_TIMEOUT_MS = Number(process.env.SEARCH_REFRESH_TIMEOUT_MS ?? 10_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const readLock = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const lockPath = () => `${tokenPath()}.lock`;

/** A timer that counts only time this process was awake: a long gap between ticks is a pause or a sleep, not waiting. */
export function awakeTimer(ms: number, onTimeout: () => void): () => void {
  let awake = 0, last = Date.now();
  const iv = setInterval(() => {
    const now = Date.now(), gap = now - last;
    last = now;
    awake += gap > 1500 ? 250 : gap;
    if (awake >= ms) { clearInterval(iv); onTimeout(); }
  }, 250);
  return () => clearInterval(iv);
}

/** Waits that count awake time only, so a waiter that was paused does not give up the moment it wakes. */
async function awakeSleep(ms: number): Promise<number> {
  const at = Date.now();
  await sleep(ms);
  return Math.min(Date.now() - at, ms + 250);
}

/** A file in the sign-in folder could not be written: say which folder and what to do, never a stack trace. */
export function fsProblem(e: unknown, path: string): CliError | null {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    const dir = dirname(path);
    return new CliError(
      code === "EROFS"
        ? `Search cannot save its sign-in: the folder ${dir} is on a read-only disk. Point SEARCH_HOME at a folder you can write to, then try again.`
        : `Search cannot save its sign-in: you do not have permission to write in ${dir}. Make it yours again (for example \`chmod u+w "${dir}"\`), or point SEARCH_HOME at a folder you can write to, then try again.`,
      EXIT.error,
    );
  }
  if (code === "ENOSPC") return new CliError(`Search cannot save its sign-in: the disk with ${dirname(path)} is full. Free some space, then try again.`, EXIT.error);
  return null;
}
function guardFs<T>(path: string, fn: () => T): T {
  try { return fn(); } catch (e) { throw fsProblem(e, path) ?? e; }
}

async function acquireLock(): Promise<string> {
  const lock = lockPath();
  guardFs(lock, () => mkdirSync(dirname(lock), { recursive: true }));
  const mine = `${process.pid} ${Date.now()} ${randomBytes(6).toString("hex")}`;
  let waited = 0;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, mine); closeSync(fd);
      return mine;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw fsProblem(e, lock) ?? e;
    }
    const held = readLock(lock);
    if (held !== null) {
      const [pid, at] = held.split(" ").map(Number);
      // an empty lock is one being written; it is stale only if it stays empty
      let emptyAge = 0;
      if (!held.trim()) { try { emptyAge = Date.now() - statSync(lock).mtimeMs; } catch { continue; } }
      const stale = !held.trim() ? emptyAge > 2000 : !pid || !alive(pid) || Date.now() - (at ?? 0) > LOCK_STALE_MS;
      if (stale) {
        // take it over: move it aside, and only drop it if it is still the stale one we judged
        const aside = `${lock}.${process.pid}.${randomBytes(4).toString("hex")}`;
        try {
          renameSync(lock, aside);
          if (readLock(aside) === held) unlinkSync(aside);
          else { try { linkSync(aside, lock); } catch { /* someone holds it now */ } unlinkSync(aside); }
        } catch { /* gone already */ }
        continue;
      }
    }
    if (waited > LOCK_WAIT_MS) throw new CliError("Another Search process is holding the sign-in. Try again in a moment.", EXIT.notRunning);
    waited += await awakeSleep(40 + Math.random() * 60);
  }
}
const holdsLock = (mine: string) => !!mine && readLock(lockPath()) === mine;
function releaseLock(mine: string): void { if (holdsLock(mine)) rmSync(lockPath(), { force: true }); }

export async function withTokenLock<T>(fn: () => Promise<T>): Promise<T> {
  const mine = await acquireLock();
  try { return await fn(); } finally { releaseLock(mine); }
}

export function dropToken(): void {
  rmSync(tokenPath(), { force: true });
}

/** The Search running on this SEARCH_HOME, from the server.json it writes when it starts (its process still alive). */
export function runningServer(): string | null {
  try {
    const r = JSON.parse(readFileSync(resolve(home(), "server.json"), "utf8")) as { url?: string; pid?: number };
    if (!r.url || !r.pid) return null;
    try { process.kill(r.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EPERM") return null; }
    return r.url;
  } catch { return null; }
}

/** The Search to talk to: --server, SEARCH_SERVER, the one running on this SEARCH_HOME, the signed-in one, else localhost:52289. Only an http(s) origin. */
export function serverUrl(flag?: string): string {
  const raw = (flag || process.env.SEARCH_SERVER || runningServer() || readToken()?.server || DEFAULT_SERVER).trim();
  let u: URL;
  try { u = new URL(raw); } catch { throw new CliError(`--server must be an address like http://localhost:52289, not ${raw}.`, EXIT.usage); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    throw new CliError(`--server must be an address like http://localhost:52289, not ${raw}.`, EXIT.usage);
  }
  return u.origin;
}

export async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
      throw new CliError(`Search is not running at ${new URL(url).origin}. Start it with \`pnpm run search\` or \`pnpm dev\` in the Search folder.`, EXIT.notRunning);
    }
    throw e;
  }
}

/**
 * POST /token. On node:http rather than fetch so no timer but ours can end it: fetch's
 * own header timeout fires the moment a process wakes from a long sleep, and an answer
 * that waited in the socket is lost. `timeoutMs` counts awake time only.
 */
export async function tokenRequest(server: string, body: Record<string, string>, opts: number | { timeoutMs?: number; beforeSend?: () => boolean } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { timeoutMs, beforeSend } = typeof opts === "number" ? { timeoutMs: opts, beforeSend: undefined } : opts;
  const u = new URL(`${server}/token`);
  // Connect first, then look once more, then send: a process paused while connecting
  // never wakes up and sends a refresh token that stopped being the current one.
  let socket: Socket | undefined;
  if (beforeSend && u.protocol === "http:") {
    socket = netConnect({ host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 80), autoSelectFamily: true });
    await new Promise<void>((ok, bad) => { socket!.once("connect", () => ok()); socket!.once("error", bad); }).catch((e: NodeJS.ErrnoException) => {
      throw e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" ? new CliError(`Search is not running at ${u.origin}. Start it with \`pnpm run search\` or \`pnpm dev\` in the Search folder.`, EXIT.notRunning) : new CliError(`Search at ${u.origin} did not answer (${e.code ?? e.message}). Try again in a moment.`, EXIT.notRunning);
    });
  }
  if (beforeSend && !beforeSend()) { socket?.destroy(); throw new StaleToken(); }
  const payload = new URLSearchParams(body).toString();
  const notRunning = () => new CliError(`Search is not running at ${u.origin}. Start it with \`pnpm run search\` or \`pnpm dev\` in the Search folder.`, EXIT.notRunning);
  return new Promise((done, fail) => {
    let settled = false;
    const finish = (f: () => void) => { if (settled) return; settled = true; stop(); f(); };
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, {
      method: "POST",
      ...(socket ? { createConnection: () => socket!, agent: false as const } : {}),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => { text += d; });
      res.on("end", () => finish(() => {
        let json: Record<string, unknown> = {};
        try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* not JSON */ }
        done({ status: res.statusCode ?? 0, json });
      }));
      res.on("error", (e) => req.emit("error", e));
    });
    const stop = timeoutMs ? awakeTimer(timeoutMs, () => req.destroy(new CliError(`Search at ${u.origin} did not answer in time. Try again in a moment.`, EXIT.notRunning))) : () => {};
    req.on("error", (e: Error) => finish(() => {
      if (e instanceof CliError) return fail(e);
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ECONNREFUSED" || code === "ENOTFOUND") return fail(notRunning());
      // the request may have reached the server and its answer been lost: the caller decides whether to ask again
      fail(new CliError(`Search at ${u.origin} did not answer (${code ?? e.message}). Try again in a moment.`, EXIT.notRunning));
    }));
    req.end(payload);
  });
}

function issued(t: TokenFile, json: Record<string, unknown>): TokenFile {
  return {
    ...t,
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token ?? t.refreshToken),
    expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000).toISOString(),
    scopes: typeof json.scope === "string" ? json.scope.split(" ") : t.scopes,
  };
}

/** Raised before sending when the file no longer holds the token this process was about to present. */
class StaleToken extends Error {}

/** A new sign-in from `search login`: nothing else could hold its refresh token yet. */
export function issuedToFile(server: string, clientId: string, json: Record<string, unknown>): TokenFile {
  const t = issued({ server, clientId, accessToken: "", refreshToken: "", expiresAt: "", scopes: [] }, json);
  writeToken(t);
  return t;
}

/** The stored sign-in, refreshed when it is about to expire. Throws when there is none. */
export async function freshToken(): Promise<TokenFile> {
  await recoverRefresh().catch(() => null);
  const t = readToken();
  if (!t) throw new CliError("Not signed in. Run `pnpm run search login` in the Search folder first.", EXIT.notSignedIn);
  return nearExpiry(t) ? refresh(t) : t;
}

/** What a person does when this sign-in is really gone, in plain words. */
export function signInEndedText(): string {
  return tokenName
    ? "Search's sign-in for this app ended. Open Search, go to Settings, Agents, and press Connect next to this app again. Then restart this app."
    : "Your Search sign-in ended. Run `pnpm run search login` in the Search folder to sign in again.";
}

/** The sign-in is gone for good (revoked, expired, removed), not just a slow server. */
export class SignInEnded extends CliError {
  constructor(public readonly reason: string) { super(signInEndedText(), EXIT.notSignedIn); }
}

const nearExpiry = (t: TokenFile) => Date.parse(t.expiresAt) - Date.now() < 30_000;
const expired = (t: TokenFile) => Date.parse(t.expiresAt) - Date.now() < 2_000;

/**
 * The note that a refresh is in flight: who sent it, when it was first sent, and a
 * fingerprint of the refresh token it presented. If that process dies before the
 * answer is saved, the next process finishes the refresh inside the server's grace.
 * A note about a token the file no longer holds is old news and is dropped.
 */
interface Note { pid: number; at: number; rt: string; owners?: number[] }
const intentPath = () => `${tokenPath()}.refreshing`;
const fingerprint = (rt: string) => createHash("sha256").update(rt).digest("hex").slice(0, 16);
function readNote(): Note | null {
  const raw = readLock(intentPath());
  if (raw === null) return null;
  try { const n = JSON.parse(raw) as Partial<Note>; return { pid: Number(n.pid ?? 0), at: Number(n.at ?? 0), rt: String(n.rt ?? ""), owners: Array.isArray(n.owners) ? n.owners.map(Number) : [Number(n.pid ?? 0)] }; } catch { return { pid: 0, at: 0, rt: "", owners: [] }; }
}
function writeNote(n: Note): void {
  const p = intentPath();
  guardFs(p, () => {
    const tmp = `${p}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(n), { mode: 0o600 });
    renameSync(tmp, p);
  });
}
const dropNote = () => rmSync(intentPath(), { force: true });
const testHook = (name: string) => Math.random() < Number(process.env[name] ?? 0);
/** tests only: one line per refresh step, to a file the stress test reads when a run fails */
const trace = (line: string) => { const f = process.env.SEARCH_TEST_TRACE; if (f) try { appendFileSync(f, `${new Date().toISOString()} ${process.pid} ${tokenName ?? "cli"} ${line}\n`); } catch { /* tests only */ } };

/** The note's owner is paused with the refresh in flight: wait (unlocked) for it to finish, counting awake time. True when something moved. */
async function waitForOwner(rtBefore: string, note: Note): Promise<boolean> {
  let waited = 0;
  while (waited < REFRESH_TIMEOUT_MS + 5_000) {
    waited += await awakeSleep(200);
    const now = readNote(), file = readToken();
    if (!file || file.refreshToken !== rtBefore) return true;
    if (!now || now.at !== note.at || !(now.owners ?? [now.pid]).some((pid) => pid && alive(pid))) return true;
  }
  return false;
}

type Want = { kind: "refresh"; have: TokenFile } | { kind: "recover" };

/**
 * The one refresh path. Under the lock, in a loop: read the file and the note; use a
 * pair another process already got; wait for a paused owner instead of presenting its
 * token past the grace; else present the file's refresh token, and after the answer
 * (or a timeout, or an error, or waking up) take the lock back, re-read the file and
 * save only if it still holds the token this process spent.
 */
async function settle(want: Want): Promise<TokenFile | null> {
  let mine = await acquireLock();
  try {
    for (let round = 0; round < 6; round++) {
      if (!holdsLock(mine)) mine = await acquireLock();
      const onDisk = readToken();
      if (!onDisk || (want.kind === "refresh" && onDisk.server !== want.have.server)) {
        dropNote();
        if (want.kind === "recover") return null;
        throw new SignInEnded("no token file");
      }
      let note = readNote();
      if (note && note.rt !== fingerprint(onDisk.refreshToken)) { dropNote(); note = null; }
      if (!note) {
        if (want.kind === "recover") return onDisk;
        if (onDisk.refreshToken !== want.have.refreshToken && !nearExpiry(onDisk)) return onDisk;
      } else if (Date.now() - note.at > TAKEOVER_MS && (note.owners ?? [note.pid]).some((pid) => pid && pid !== process.pid && alive(pid))) {
        // A process that sent this token is paused with the answer possibly waiting in
        // its socket, and the server's grace has passed: presenting that token again
        // would end the sign-in. Wait for it (every process that sent it is listed).
        releaseLock(mine); mine = "";
        if (await waitForOwner(onDisk.refreshToken, note)) continue;
        if (!expired(onDisk)) return onDisk; // the access token still works meanwhile
        throw new CliError("Another app using this Search sign-in is paused in the middle of renewing it. Try again in a moment, or quit the paused app.", EXIT.notRunning);
      }
      // present the token the file holds right now, and nothing else
      const sent = onDisk.refreshToken;
      // the grace runs from the first time this token was sent, by whichever process
      const firstAt = note ? note.at : Date.now();
      if (!holdsLock(mine) || readToken()?.refreshToken !== sent) continue;
      writeNote({ pid: process.pid, at: firstAt, rt: fingerprint(sent), owners: [...new Set([...(note?.owners ?? []), process.pid])].filter((pid) => pid === process.pid || alive(pid)).slice(-16) });
      trace(`present ${fingerprint(sent)} note=${note ? `${note.pid}${note.pid === process.pid ? "(me)" : alive(note.pid) ? "(alive)" : "(dead)"} age=${Date.now() - note.at}` : "none"} want=${want.kind}`);
      let r: { status: number; json: Record<string, unknown> } | null = null;
      try {
        r = await tokenRequest(onDisk.server, { grant_type: "refresh_token", client_id: onDisk.clientId, refresh_token: sent }, {
          timeoutMs: REFRESH_TIMEOUT_MS,
          beforeSend: () => holdsLock(mine) && readToken()?.refreshToken === sent,
        });
        if (r.status === 200 && testHook("SEARCH_TEST_LOSE_REFRESH")) r = null;
      } catch (e) {
        if (e instanceof StaleToken) continue; // paused before sending, and the file moved on: look again
        if (!(e instanceof CliError) || e.exit !== EXIT.notRunning) throw e;
        if (/is not running/.test(e.message)) throw e; // nothing reached the server
      }
      if (r?.status === 200 && testHook("SEARCH_TEST_DIE_IN_REFRESH")) process.kill(process.pid, "SIGKILL");
      // Awake again (an answer, a timeout, an error, a pause): take the lock back and look before anything else.
      if (!holdsLock(mine)) mine = await acquireLock();
      const now = readToken();
      trace(`answer ${fingerprint(sent)} ${r ? r.status : "none"} file=${now ? fingerprint(now.refreshToken) : "gone"} lock=${holdsLock(mine)}`);
      if (!now || now.refreshToken !== sent) continue; // another process finished it: its file wins, never this answer
      if (r?.status === 200) {
        const t = issued(now, r.json);
        if (!holdsLock(mine) || readToken()?.refreshToken !== sent) continue;
        writeToken(t);
        dropNote();
        return t;
      }
      if (r && r.status >= 500) throw new CliError(`Search could not refresh the sign-in just now (${r.status}). Try again in a moment.`);
      if (r) {
        // invalid_grant and friends: this sign-in is over; the file still holds what we sent, so drop it
        dropNote();
        dropToken();
        throw new SignInEnded(String(r.json.error_description ?? r.json.error ?? r.status));
      }
      // No answer. Inside the grace the server answers the same pair again, so ask again;
      // past it, stop here and leave the note: the next call (or the next process) tries again.
      if (Date.now() - firstAt > TAKEOVER_MS) throw new CliError(`Search at ${onDisk.server} did not answer in time. Try again in a moment.`, EXIT.notRunning);
    }
    throw new CliError("Search could not renew the sign-in just now. Try again in a moment.", EXIT.notRunning);
  } finally {
    releaseLock(mine);
  }
}

/**
 * A fresh pair for `t`, safe with any number of processes on the same token file:
 * under the lock, re-read the file; when another process already refreshed past
 * `t`, use its pair; else refresh what the file holds and write the answer atomically.
 */
export async function refresh(t: TokenFile): Promise<TokenFile> {
  return (await settle({ kind: "refresh", have: t }))!;
}

/**
 * A process died in the middle of a refresh (its note is still there, its process is
 * gone): finish that refresh now, while the server still answers the same new pair.
 * Cheap when there is nothing to do; bridges call it on every message.
 */
export async function recoverRefresh(): Promise<TokenFile | null> {
  const note = readNote();
  if (!note) return null;
  // one that sent it is still on it (or paused: it finishes when it wakes)
  if ((note.owners ?? [note.pid]).some((pid) => pid && (pid === process.pid || alive(pid)))) return null;
  return settle({ kind: "recover" });
}

export interface ApiResult<T> { status: number; data: T; res: Response }

/** A bearer request to /api/v1 on the signed-in server. Refreshes once on 401 or when the access token is about to expire. */
export async function api<T = any>(method: string, path: string, body?: unknown, opts: { server?: string } = {}): Promise<T> {
  await recoverRefresh().catch(() => null);
  let t = readToken();
  if (!t) throw new CliError("Not signed in. Run `pnpm run search login` in the Search folder first.", EXIT.notSignedIn);
  if (opts.server && opts.server !== t.server) throw new CliError(`Signed in to ${t.server}, not ${opts.server}. Run \`pnpm run search login --server ${opts.server}\`.`, EXIT.notSignedIn);
  if (nearExpiry(t)) t = await refresh(t);
  const send = (tok: TokenFile) => reach(`${tok.server}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${tok.accessToken}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res = await send(t);
  if (res.status === 401) {
    t = await refresh(t);
    res = await send(t);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) throw new CliError(`Not signed in (${data?.error?.message ?? "401"}). Run \`pnpm run search login\`.`, EXIT.notSignedIn);
  if (!res.ok) {
    const code = data?.error?.code;
    const msg = data?.error?.message ?? `${res.status} ${res.statusText}`;
    if (code === "not_signed_in") throw new CliError(`${msg} Run \`pnpm run search login\` again.`, EXIT.notSignedIn);
    throw new CliError(code === "insufficient_scope" ? `${msg} Run \`pnpm run search login\` to grant it.` : msg);
  }
  return data as T;
}
