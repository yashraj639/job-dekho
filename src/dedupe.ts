import type { State } from "./state";
import type { Job } from "./types";

/**
 * Drop anything already recorded in state, plus repeats inside this batch.
 * Checks `notified` as well as `seen`, so a pruned `seen` entry can never
 * cause a second alert for the same job.
 */
export function dedupe(jobs: readonly Job[], state: State): Job[] {
  const known = new Set<string>([...Object.keys(state.seen), ...state.notified]);
  const kept: Job[] = [];

  for (const job of jobs) {
    if (known.has(job.id)) continue;
    known.add(job.id);
    kept.push(job);
  }

  return kept;
}
