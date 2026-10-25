import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyState,
  loadState,
  markNotified,
  markSeen,
  pruneState,
  saveState,
  toDateKey,
} from "../src/state";

describe("loadState", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jobdekho-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("missing file means empty state", async () => {
    expect(await loadState(join(dir, "nope.json"))).toEqual(emptyState());
  });

  test("saved state loads back unchanged", async () => {
    const path = join(dir, "state.json");
    const state = { seen: { "remotive:1": "2026-10-20" }, notified: ["remotive:1"] };

    await saveState(path, state);

    expect(await loadState(path)).toEqual(state);
  });

  test("invalid JSON is rejected, not silently reset", async () => {
    const path = join(dir, "state.json");
    await Bun.write(path, "not json");

    await expect(loadState(path)).rejects.toThrow("not valid JSON");
  });

  test("wrong shape is rejected", async () => {
    const path = join(dir, "state.json");
    await Bun.write(path, JSON.stringify({ seen: { "remotive:1": "yesterday" } }));

    await expect(loadState(path)).rejects.toThrow("wrong shape");
  });
});

describe("markSeen / markNotified", () => {
  test("markSeen adds the date without mutating the original", () => {
    const before = emptyState();
    const after = markSeen(before, "remotive:1", new Date("2026-10-25T10:00:00Z"));

    expect(after.seen).toEqual({ "remotive:1": "2026-10-25" });
    expect(before.seen).toEqual({});
  });

  test("markNotified is idempotent", () => {
    const once = markNotified(emptyState(), "remotive:1");
    const twice = markNotified(once, "remotive:1");

    expect(twice.notified).toEqual(["remotive:1"]);
  });
});

describe("pruneState", () => {
  const now = new Date("2026-10-25T00:00:00Z");

  test("drops entries older than 90 days and keeps the rest", () => {
    const state = {
      seen: {
        "remotive:old": "2026-07-26", // 91 days
        "remotive:edge": "2026-07-27", // exactly 90 days
        "remotive:new": "2026-10-24",
      },
      notified: ["remotive:old"],
    };

    const pruned = pruneState(state, now);

    expect(Object.keys(pruned.seen).sort()).toEqual(["remotive:edge", "remotive:new"]);
    expect(pruned.notified).toEqual(["remotive:old"]);
  });

  test("leaves notified untouched", () => {
    const state = { seen: {}, notified: ["a", "b"] };
    expect(pruneState(state, now).notified).toEqual(["a", "b"]);
  });
});

test("toDateKey is a sortable day string", () => {
  expect(toDateKey(new Date("2026-01-05T23:59:59Z"))).toBe("2026-01-05");
});
