import { describe, expect, test } from "bun:test";
import { dedupe } from "../src/dedupe";
import type { State } from "../src/state";
import { makeJob } from "./helpers";

function makeState(seen: Record<string, string> = {}, notified: string[] = []): State {
  return { seen, notified };
}

describe("dedupe", () => {
  test("drops jobs already in state.seen", () => {
    const jobs = [makeJob({ id: "remotive:1" }), makeJob({ id: "remotive:2" })];
    const state = makeState({ "remotive:1": "2026-10-20" });

    expect(dedupe(jobs, state).map((job) => job.id)).toEqual(["remotive:2"]);
  });

  test("drops jobs in state.notified even if seen was pruned", () => {
    const jobs = [makeJob({ id: "remotive:1" })];
    const state = makeState({}, ["remotive:1"]);

    expect(dedupe(jobs, state)).toEqual([]);
  });

  test("keeps everything when state is empty", () => {
    const jobs = [makeJob({ id: "remotive:1" }), makeJob({ id: "remotive:2" })];

    expect(dedupe(jobs, makeState())).toHaveLength(2);
  });

  test("drops a repeat inside the same batch, keeping the first", () => {
    const first = { ...makeJob({ id: "remotive:1" }), title: "First copy" };
    const second = { ...makeJob({ id: "remotive:1" }), title: "Second copy" };

    const kept = dedupe([first, second], makeState());

    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toBe("First copy");
  });

  test("does not mutate the input or the state", () => {
    const jobs = [makeJob({ id: "remotive:1" }), makeJob({ id: "remotive:2" })];
    const state = makeState();

    dedupe(jobs, state);

    expect(jobs).toHaveLength(2);
    expect(state.seen).toEqual({});
    expect(state.notified).toEqual([]);
  });

  test("an empty input is fine", () => {
    expect(dedupe([], makeState())).toEqual([]);
  });
});
