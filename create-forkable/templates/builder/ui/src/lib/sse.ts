import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectEvent, ProjectEventType } from "@builder/core/api-types";
import type { TurnEventRow, VersionPreview } from "@builder/core/types";
import { eventsUrl } from "./api";
import { addCheckpoint, keys, mergeRows, patchProject, patchTurn, upsertTurn, type PublishSteps } from "./queries";
import { toast } from "./toast";

const TYPES: ProjectEventType[] = [
  "hello", "turn.started", "turn.event", "turn.status", "turn.ended", "checkpoint.created", "preview.status",
  "preview.hmr", "errors.changed", "install", "harness.denied", "project.updated", "scopes.changed", "activity",
  "publish.progress", "publish.done", "env.changed", "version.status",
];

export interface InstallState { state: "running" | "done" | "failed"; tail: string }

/**
 * Opens the project's event stream and keeps the query cache current. The
 * server replays a running turn's ring buffer on connect; rows merge by seq,
 * so a replay never doubles a card.
 */
export function useProjectEvents(projectId: string, onEvent?: (e: ProjectEvent) => void): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    const es = new EventSource(eventsUrl(projectId));
    let dropped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dirty = new Set<string>();
    const mark = (...what: string[]) => {
      what.forEach((w) => dirty.add(w));
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (dirty.has("errors")) qc.invalidateQueries({ queryKey: keys.errors(projectId) });
          if (dirty.has("files")) {
            qc.invalidateQueries({ queryKey: keys.files(projectId) });
            qc.invalidateQueries({ queryKey: ["file", projectId] });
          }
          if (dirty.has("checkpoints")) qc.invalidateQueries({ queryKey: keys.checkpoints(projectId) });
          if (dirty.has("projects")) qc.invalidateQueries({ queryKey: keys.projects });
          if (dirty.has("scopes")) {
            qc.invalidateQueries({ queryKey: keys.scopes(projectId) });
            qc.invalidateQueries({ queryKey: keys.projectConnect(projectId) });
          }
          if (dirty.has("activity")) qc.invalidateQueries({ queryKey: keys.activity(projectId) });
          if (dirty.has("env")) qc.invalidateQueries({ queryKey: keys.env(projectId) });
          dirty.clear();
        }, 200);
      }
    };

    const handle = (ev: ProjectEvent) => {
      cb.current?.(ev);
      switch (ev.type) {
        case "turn.started":
          upsertTurn(qc, projectId, ev.turn);
          patchProject(qc, projectId, { activeTurnId: ev.turn.id });
          break;
        case "turn.event": {
          const row: TurnEventRow = { turnId: ev.turnId, seq: ev.seq, event: ev.event, at: ev.at };
          qc.setQueryData<TurnEventRow[]>(keys.turnEvents(projectId, ev.turnId), (old) => mergeRows(old, [row]));
          if (ev.event.t === "tool_end" || ev.event.t === "checkpoint") mark("files");
          if (ev.event.t === "connect_needed" || ev.event.t === "connect_offer") mark("scopes");
          if (ev.event.t === "step") qc.setQueryData(keys.turnStep(ev.turnId), ev.event.step);
          break;
        }
        case "turn.status":
          patchTurn(qc, projectId, ev.turnId, { status: ev.status, fixAttempt: ev.fixAttempt });
          if (ev.step !== undefined) qc.setQueryData(keys.turnStep(ev.turnId), ev.step);
          break;
        case "turn.ended":
          upsertTurn(qc, projectId, ev.turn);
          qc.setQueryData(keys.turnStep(ev.turn.id), null);
          qc.invalidateQueries({ queryKey: keys.project(projectId) });
          mark("errors", "files", "checkpoints", "projects", "env");
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            try { new Notification(ev.turn.status === "done" ? "Your app is ready" : "The agent stopped", { body: ev.turn.prompt.slice(0, 80) }); } catch { /* ignore */ }
          }
          break;
        case "checkpoint.created":
          addCheckpoint(qc, projectId, ev.checkpoint);
          mark("files", "projects");
          break;
        case "preview.status":
          patchProject(qc, projectId, { preview: ev.state, previewStep: ev.step ?? null });
          break;
        case "version.status":
          qc.setQueryData<VersionPreview | null>(keys.version(projectId), (old) => (old && old.sha === ev.sha ? { ...old, state: ev.state, step: ev.step ?? null, message: ev.message ?? null } : old));
          if (ev.state === "stopped") void qc.invalidateQueries({ queryKey: keys.version(projectId) });
          break;
        case "errors.changed":
          patchProject(qc, projectId, { openErrors: ev.open });
          mark("errors");
          break;
        case "install":
          qc.setQueryData<InstallState>(["install", projectId], { state: ev.state, tail: ev.tail });
          if (ev.state === "failed") toast({ title: "Could not install packages", detail: "See the console strip", tone: "destructive" });
          break;
        case "project.updated":
          qc.setQueryData(keys.project(projectId), ev.project);
          break;
        case "scopes.changed":
          mark("scopes");
          break;
        case "activity":
          mark("activity");
          break;
        case "publish.progress":
          qc.setQueryData<PublishSteps>(keys.publishSteps(projectId), (old = {}) => {
            const cur = old[ev.target];
            // A new publish (or a new scan run) starts its own list.
            const fresh = !cur || cur.publishId !== ev.publishId || (ev.target === "scan" && ev.step === "files" && ev.status === "running");
            const steps = fresh ? [] : [...cur.steps];
            const i = steps.findIndex((x) => x.step === ev.step);
            const row = { step: ev.step, status: ev.status, detail: ev.detail ?? null };
            if (i >= 0) steps[i] = row;
            else steps.push(row);
            return { ...old, [ev.target]: { publishId: ev.publishId, steps } };
          });
          break;
        case "env.changed":
          mark("env");
          break;
        case "publish.done":
          qc.invalidateQueries({ queryKey: keys.publishes(projectId) });
          qc.invalidateQueries({ queryKey: keys.project(projectId) });
          qc.invalidateQueries({ queryKey: keys.scopes(projectId) });
          mark("checkpoints", "projects", "activity");
          break;
        default:
          break;
      }
    };

    const listeners = TYPES.map((type) => {
      const fn = (m: MessageEvent) => {
        let data: ProjectEvent;
        try { data = JSON.parse(m.data) as ProjectEvent; } catch { return; }
        if (!data.type) data = { ...(data as object), type } as ProjectEvent;
        handle(data);
      };
      es.addEventListener(type, fn as EventListener);
      return [type, fn] as const;
    });
    es.onopen = () => {
      setConnected(true);
      if (dropped) {
        // Back after a drop: refetch what the stream would have told us.
        qc.invalidateQueries({ queryKey: keys.project(projectId) });
        qc.invalidateQueries({ queryKey: keys.turns(projectId) });
        mark("errors", "checkpoints");
      }
    };
    es.onerror = () => { setConnected(false); dropped = true; };
    return () => {
      for (const [type, fn] of listeners) es.removeEventListener(type, fn as EventListener);
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [projectId, qc]);

  return { connected };
}
