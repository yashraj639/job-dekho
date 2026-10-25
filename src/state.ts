import { z } from "zod";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const StateSchema = z.object({
  seen: z.record(z.string(), z.string().regex(DATE_KEY, "expected YYYY-MM-DD")),
  notified: z.array(z.string()),
});
export type State = z.infer<typeof StateSchema>;

/** `seen` entries older than this are dropped so the file does not grow forever. */
export const STATE_RETENTION_DAYS = 90;

const MS_PER_DAY = 86_400_000;

export function emptyState(): State {
  return { seen: {}, notified: [] };
}

export async function loadState(path: string): Promise<State> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyState();

  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`state file ${path} is not valid JSON`);
  }

  const parsed = StateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`state file ${path} has the wrong shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function saveState(path: string, state: State): Promise<void> {
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** `2026-10-25` — sortable, so plain string comparison works for pruning. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function markSeen(state: State, id: string, date: Date): State {
  return { ...state, seen: { ...state.seen, [id]: toDateKey(date) } };
}

export function markNotified(state: State, id: string): State {
  if (state.notified.includes(id)) return state;
  return { ...state, notified: [...state.notified, id] };
}

export function pruneState(state: State, now: Date): State {
  const cutoff = toDateKey(new Date(now.getTime() - STATE_RETENTION_DAYS * MS_PER_DAY));
  const seen = Object.fromEntries(
    Object.entries(state.seen).filter(([, dateKey]) => dateKey >= cutoff),
  );
  return { ...state, seen };
}
