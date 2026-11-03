import type { ProjectEvent } from "./api-types.js";

/** Project events out of core; the server's SSE hub listens. */
export interface Bus {
  emit(projectId: string, event: ProjectEvent): void;
  on(listener: (projectId: string, event: ProjectEvent) => void): () => void;
}

export function createBus(): Bus {
  const listeners = new Set<(projectId: string, event: ProjectEvent) => void>();
  return {
    emit(projectId, event) {
      for (const l of listeners) {
        try {
          l(projectId, event);
        } catch {
          /* a broken listener must not stop a turn */
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
