import type { Run } from "./types.js";

// Runs a live check has made, kept in this process so the report blocks have
// something to read. Swap it for your own table: Brief stores runs in
// Postgres and runs every prompt on a schedule.
const runs: Run[] = [];
export const runStore = {
  add(r: Run[]) {
    runs.push(...r);
    if (runs.length > 5000) runs.splice(0, runs.length - 5000);
  },
  all: (): Run[] => [...runs],
};
