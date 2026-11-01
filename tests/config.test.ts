import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadFilters } from "../src/config";

const SHIPPED_FILTERS = join(import.meta.dir, "..", "config", "filters.json");

test("the shipped config/filters.json is valid", async () => {
  const filters = await loadFilters(SHIPPED_FILTERS);

  expect(filters.roleKeywords).toContain("AI intern");
  expect(filters.roleKeywords).not.toContain("engineer");
  expect(filters.stackKeywords).toContain("artificial intelligence");
  expect(filters.resumeKeywords).toContain("langchain");
  expect(filters.allowedLocations).toContain("Hyderabad");
});

test("a missing config file is a clear error", async () => {
  await expect(loadFilters(join(import.meta.dir, "nope.json"))).rejects.toThrow("missing config file");
});

test("a config with the wrong shape is rejected with the offending field", async () => {
  const path = join(import.meta.dir, "fixtures", "filters-broken.json");

  await expect(loadFilters(path)).rejects.toThrow("maxAgeDays");
});
