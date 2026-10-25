import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fetchHn, parseListingTitle } from "../src/sources/hn";
import { JobSchema } from "../src/types";

const SEARCH_FIXTURE_PATH = join(import.meta.dir, "fixtures", "hn-search.json");
const ITEMS_FIXTURE_PATH = join(import.meta.dir, "fixtures", "hn-items.json");

const SEARCH_URL_PREFIX = "https://hn.algolia.com/api/v1/search_by_date";
const ITEMS_URL_PREFIX = "https://hn.algolia.com/api/v1/items/";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchRouting(
  searchFixture: unknown,
  itemsFixture: unknown,
): (input: unknown) => Promise<Response> {
  return async (input) => {
    const url = String(input);
    if (url.startsWith(ITEMS_URL_PREFIX)) return jsonResponse(itemsFixture);
    if (url.startsWith(SEARCH_URL_PREFIX)) return jsonResponse(searchFixture);
    throw new Error(`unexpected fetch url ${url}`);
  };
}

describe("parseListingTitle", () => {
  test('splits the canonical "Company | Role | Location" format', () => {
    const parsed = parseListingTitle("Acme Systems | Junior Backend Developer | Remote (Worldwide)");

    expect(parsed.company).toBe("Acme Systems");
    expect(parsed.title).toBe("Junior Backend Developer");
  });

  test("falls back to the parenthesised variant", () => {
    const parsed = parseListingTitle(
      "PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript / React",
    );

    expect(parsed.company).toBe("PrairieLearn");
    expect(parsed.title).toContain("Full-Stack Software Engineer");
  });

  test("keeps the whole line when nothing matches", () => {
    const parsed = parseListingTitle("We are hiring engineers soon, watch this space");

    expect(parsed.company).toBe("We are hiring engineers soon, watch this space");
    expect(parsed.title).toContain("hiring engineers");
  });
});

describe("fetchHn", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  /** `typeof fetch` also carries `preconnect`, which a test stub never needs. */
  function mockFetch(impl: (input: unknown) => Promise<Response>): void {
    fetchSpy.mockImplementation(impl as unknown as typeof fetch);
  }

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("normalizes top-level comments of the Who is hiring thread into valid jobs", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const searchFixture = await Bun.file(SEARCH_FIXTURE_PATH).json();
    const itemsFixture = await Bun.file(ITEMS_FIXTURE_PATH).json();
    mockFetch(async (input) => mockFetchRouting(searchFixture, itemsFixture)(input));

    const jobs = await fetchHn();

    expect(jobs).toHaveLength(2); // the deleted comment is skipped
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }

    const first = jobs[0];
    expect(first?.id).toBe("hn:49922584");
    expect(first?.company).toBe("PrairieLearn");
    expect(first?.title).toContain("Full-Stack Software Engineer");
    expect(first?.remote).toBe(true);
    expect(first?.postedAt).toBe("2026-10-01T15:02:37.000Z");
    expect(first?.description).toContain("open-source assessment platform");

    const second = jobs[1];
    expect(second?.company).toBe("Acme Systems");
    expect(second?.title).toBe("Junior Backend Developer");
    expect(second?.description).toContain("Node.js and TypeScript");
    expect(log).toHaveBeenCalledWith(
      "source=hn thread=49922569 in=3 out=2 skipped=1",
    );
    log.mockRestore();
  });

  test("a dead network returns [] and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => {
      throw new TypeError("network down");
    });

    const jobs = await fetchHn();

    expect(jobs).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith("source=hn error=network down");
    errorLog.mockRestore();
  });

  test("a search with no Who is hiring thread returns [] with a one-line log", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => jsonResponse({ hits: [{ objectID: "1", title: "Ask HN: unrelated" }] }));

    const jobs = await fetchHn();

    expect(jobs).toEqual([]);
    const logged = errorLog.mock.calls[0]?.[0];
    expect(logged as string).toStartWith("source=hn error=");
    expect(logged as string).not.toContain("\n");
    errorLog.mockRestore();
  });

  test("an HTTP error on the thread fetch returns []", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const searchFixture = await Bun.file(SEARCH_FIXTURE_PATH).json();
    mockFetch(async (input) => {
      const url = String(input);
      if (url.startsWith(ITEMS_URL_PREFIX)) return new Response("boom", { status: 500 });
      return jsonResponse(searchFixture);
    });

    const jobs = await fetchHn();

    expect(jobs).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith("source=hn error=HTTP 500");
    errorLog.mockRestore();
  });
});
