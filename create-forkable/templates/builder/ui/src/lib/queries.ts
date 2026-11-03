import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import type { ActivityResponse, CheckpointsResponse, CreateProjectBody, CreateTurnBody, ProjectConnectBody, ProjectPatch, PublishStep, ScopesResponse, SettingsPatch, TurnsResponse, VisitorsPatchBody } from "@builder/core/api-types";
import type { Checkpoint, Project, Turn, TurnEventRow } from "@builder/core/types";
import { api } from "./api";

export const keys = {
  health: ["health"] as const,
  me: ["me"] as const,
  harnesses: ["harnesses"] as const,
  settings: ["settings"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  turns: (id: string) => ["turns", id] as const,
  turnEvents: (id: string, turnId: string) => ["turnEvents", id, turnId] as const,
  turnStep: (turnId: string) => ["turnStep", turnId] as const,
  files: (id: string) => ["files", id] as const,
  file: (id: string, path: string) => ["file", id, path] as const,
  checkpoints: (id: string) => ["checkpoints", id] as const,
  diff: (id: string, sha: string) => ["diff", id, sha] as const,
  errors: (id: string) => ["errors", id] as const,
  scopes: (id: string) => ["scopes", id] as const,
  oneCli: ["oneCli"] as const,
  connectTemplates: ["connectTemplates"] as const,
  projectConnect: (id: string) => ["projectConnect", id] as const,
  activity: (id: string) => ["activity", id] as const,
  publishes: (id: string) => ["publishes", id] as const,
  publishSteps: (id: string) => ["publishSteps", id] as const,
  env: (id: string) => ["env", id] as const,
  version: (id: string) => ["version", id] as const,
};

export const useHealth = () => useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 60_000, retry: 0 });
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 60_000 });
export const useHarnesses = () => useQuery({ queryKey: keys.harnesses, queryFn: () => api.harnesses(), staleTime: 5 * 60_000 });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings, staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useProject = (id: string) => useQuery({ queryKey: keys.project(id), queryFn: () => api.project(id).then((r) => r.project), enabled: !!id });
export const useFiles = (id: string) => useQuery({ queryKey: keys.files(id), queryFn: () => api.files(id).then((r) => r.files) });
export const useFile = (id: string, path: string | null) =>
  useQuery({ queryKey: keys.file(id, path ?? ""), queryFn: () => api.file(id, path!), enabled: !!path, staleTime: 0 });
export const useCheckpoints = (id: string) => useQuery({ queryKey: keys.checkpoints(id), queryFn: () => api.checkpoints(id).then((r) => r.checkpoints) });
export const useDiff = (id: string, sha: string | null) =>
  useQuery({ queryKey: keys.diff(id, sha ?? ""), queryFn: () => api.diff(id, sha!), enabled: !!sha, staleTime: Infinity });
/** The open version preview (Preview this version), or null. */
export const useVersion = (id: string) => useQuery({ queryKey: keys.version(id), queryFn: () => api.version(id).then((r) => r.version) });
export const useErrors = (id: string) => useQuery({ queryKey: keys.errors(id), queryFn: () => api.errors(id).then((r) => r.errors) });

export const useScopes = (id: string) => useQuery({ queryKey: keys.scopes(id), queryFn: () => api.scopes(id) });
export const usePublishes = (id: string, enabled = true) => useQuery({ queryKey: keys.publishes(id), queryFn: () => api.publishes(id), enabled });

/** Live steps from publish.progress, by target ("scan", "github", "vercel"). */
export type PublishSteps = Partial<Record<"scan" | "github" | "vercel", { publishId: number | null; steps: PublishStep[] }>>;
export function usePublishSteps(id: string): PublishSteps {
  return useQuery({ queryKey: keys.publishSteps(id), queryFn: () => ({}) as PublishSteps, enabled: false, initialData: {} as PublishSteps }).data;
}

/** The One CLI: found, version, signed in (Settings, One CLI). Polls while a `one login` waits for the browser. */
export const useOneCli = () =>
  useQuery({ queryKey: keys.oneCli, queryFn: () => api.oneCli().then((r) => r.cli), staleTime: 30_000, refetchInterval: (q) => (q.state.data?.loginRunning ? 2000 : false) });
/** Saved Connect apps: templates and every project's own. */
export const useConnectTemplates = () => useQuery({ queryKey: keys.connectTemplates, queryFn: api.connectTemplates, staleTime: 10_000 });
/** A project's One Connect (its Settings tab, Access, Publish, the turn-end card). */
export const useProjectConnect = (id: string) => useQuery({ queryKey: keys.projectConnect(id), queryFn: () => api.projectConnect(id), staleTime: 10_000, enabled: !!id });

export function useSetProjectConnect(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectConnectBody) => api.setProjectConnect(id, body),
    onSuccess: (r) => {
      qc.setQueryData(keys.projectConnect(id), r);
      void qc.invalidateQueries({ queryKey: keys.connectTemplates });
      void qc.invalidateQueries({ queryKey: keys.publishes(id) });
      void qc.invalidateQueries({ queryKey: keys.project(id) });
    },
  });
}

export function useActivity(id: string) {
  return useInfiniteQuery({
    queryKey: keys.activity(id),
    queryFn: ({ pageParam }) => api.activity(id, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last: ActivityResponse) => last.nextBefore,
  });
}

export function useTurns(id: string) {
  return useInfiniteQuery({
    queryKey: keys.turns(id),
    queryFn: ({ pageParam }) => api.turns(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TurnsResponse) => last.nextBefore,
  });
}

/** Merge event rows by seq, keeping order. */
export function mergeRows(a: TurnEventRow[] | undefined, b: TurnEventRow[]): TurnEventRow[] {
  if (!a?.length) return [...b].sort((x, y) => x.seq - y.seq);
  const seen = new Set(a.map((r) => r.seq));
  const add = b.filter((r) => !seen.has(r.seq));
  if (!add.length) return a;
  return [...a, ...add].sort((x, y) => x.seq - y.seq);
}

export function useTurnEvents(projectId: string, turnId: string, live: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.turnEvents(projectId, turnId),
    queryFn: async () => {
      const r = await api.turnEvents(projectId, turnId);
      return mergeRows(qc.getQueryData<TurnEventRow[]>(keys.turnEvents(projectId, turnId)), r.events);
    },
    staleTime: live ? 0 : Infinity,
  });
}

export function upsertTurn(qc: QueryClient, projectId: string, turn: Turn) {
  qc.setQueryData<InfiniteData<TurnsResponse, string | null>>(keys.turns(projectId), (old) => {
    if (!old) return old;
    let found = false;
    const pages = old.pages.map((p) => ({
      ...p,
      turns: p.turns.map((t) => {
        if (t.id !== turn.id) return t;
        found = true;
        return { ...t, ...turn };
      }),
    }));
    if (!found && pages[0]) pages[0] = { ...pages[0], turns: [turn, ...pages[0].turns] };
    return { ...old, pages };
  });
}

export function patchTurn(qc: QueryClient, projectId: string, turnId: string, patch: Partial<Turn>) {
  qc.setQueryData<InfiniteData<TurnsResponse, string | null>>(keys.turns(projectId), (old) => {
    if (!old) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, turns: p.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) })) };
  });
}

export function patchProject(qc: QueryClient, projectId: string, patch: Partial<Project>) {
  qc.setQueryData<Project>(keys.project(projectId), (old) => (old ? { ...old, ...patch } : old));
}

export function addCheckpoint(qc: QueryClient, projectId: string, cp: Checkpoint) {
  qc.setQueryData<Checkpoint[]>(keys.checkpoints(projectId), (old) => {
    if (!old) return old;
    return [cp, ...old.filter((c) => c.sha !== cp.sha)];
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) => api.createProject(body),
    onSuccess: (r) => {
      qc.setQueryData(keys.project(r.project.id), r.project);
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function usePatchProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProjectPatch) => api.patchProject(id, patch),
    onSuccess: (r) => {
      qc.setQueryData(keys.project(id), r.project);
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onSuccess: (r) => qc.setQueryData(keys.settings, r),
  });
}

/** Visitors on the builder's grant (Access group and the chat card). */
export function useSetVisitors(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VisitorsPatchBody) => api.setVisitors(id, body),
    onSuccess: (r) => {
      qc.setQueryData<ScopesResponse>(keys.scopes(id), (old) => (old ? { ...old, visitors: r.visitors } : old));
      void qc.invalidateQueries({ queryKey: keys.scopes(id) });
    },
  });
}

export function useCreateTurn(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTurnBody) => api.createTurn(id, body),
    onSuccess: (r) => upsertTurn(qc, id, r.turn),
  });
}

export function useFix(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (errorIds?: string[]) => api.fix(id, errorIds ? { errorIds } : {}),
    onSuccess: (r) => upsertTurn(qc, id, r.turn),
  });
}

export function useRestore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sha: string) => api.restore(id, sha),
    onSuccess: (r) => {
      if (r.checkpoint) addCheckpoint(qc, id, r.checkpoint);
      qc.invalidateQueries({ queryKey: keys.files(id) });
      qc.invalidateQueries({ queryKey: ["file", id] });
    },
  });
}

export function useBookmark(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sha, on }: { sha: string; on: boolean }) => api.bookmark(id, sha, on),
    onMutate: ({ sha, on }) => {
      qc.setQueryData<Checkpoint[]>(keys.checkpoints(id), (old) => old?.map((c) => (c.sha === sha ? { ...c, bookmarked: on } : c)));
    },
  });
}

/** A project's Environment: names the code reads, set or missing. */
export const useProjectEnv = (id: string) => useQuery({ queryKey: keys.env(id), queryFn: () => api.projectEnv(id), staleTime: 5_000 });

export function useSaveProjectEnv(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string>) => api.saveProjectEnv(id, values),
    onSuccess: (r) => {
      qc.setQueryData(keys.env(id), r);
      void qc.invalidateQueries({ queryKey: keys.project(id) });
    },
  });
}

export function useRemoveProjectEnv(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.removeProjectEnv(id, name),
    onSuccess: (r) => qc.setQueryData(keys.env(id), r),
  });
}

export type { CheckpointsResponse };
