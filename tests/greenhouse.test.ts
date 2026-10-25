import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fetchGreenhouse, normalizeGreenhouseJob, type GreenhouseJob } from "../src/sources/greenhouse";
import { JobSchema } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "greenhouse.json");
const BOARD_URL_PREFIX = "https://boards-api.greenhouse.io/v1/boards/";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawJob(overrides: Partial<GreenhouseJob> = {}): GreenhouseJob {
  return {
    id: 6136160004,
    title: "Junior Full Stack Engineer",
    absolute_url: "https://boards.greenhouse.io/acme-systems/jobs/6136160004",
    location: { name: "Remote - India" },
    content: "<p>We are looking for a <strong>Junior Full Stack Engineer</strong>. React &amp; TypeScript.</p>",
    first_published: "2026-10-20T12:00:00-04:00",
    updated_at: "2026-10-21T12:00:00-04:00",
    ...overrides,
  };
}

describe("normalizeGreenhouseJob", () => {
  test("maps a Greenhouse listing onto the Job shape", () => {
    const job = normalizeGreenhouseJob(rawJob(), "acme-systems");

    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(job.id).toBe("greenhouse:6136160004");
    expect(job.source).toBe("greenhouse");
    expect(job.company).toBe("Acme Systems");
    expect(job.location).toBe("Remote - India");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBe("2026-10-20T12:00:00-04:00");
    expect(job.description).toContain("Junior Full Stack Engineer");
  });

  test("falls back to updated_at and null when data is missing", () => {
    const job = normalizeGreenhouseJob(
      rawJob({
        first_published: null,
        updated_at: "2026-10-22T09:00:00-04:00",
        location: null,
        content: null,
      }),
      "vercel",
    );

    expect(job.company).toBe("Vercel");
    expect(job.location).toBe("");
    expect(job.remote).toBeNull();
    expect(job.postedAt).toBe("2026-10-22T09:00:00-04:00");
    expect(job.description).toBe("");
  });
});

describe("fetchGreenhouse", () => {
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

  test("normalizes the saved fixture into valid jobs", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async () => jsonResponse(fixture));

    const jobs = await fetchGreenhouse(["acme-systems"]);
    log.mockRestore();

    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }
    expect(jobs[0]?.company).toBe("Acme Systems");
    expect(jobs[0]?.location).toBe("Remote - India");
    expect(jobs[1]?.location).toBe("");
  });

  test("one failing board does not take the others down", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async (input) => {
      const url = String(input);
      if (!url.startsWith(BOARD_URL_PREFIX) || !url.includes("/boards/unhappy/")) {
        return jsonResponse(fixture);
      }
      throw new TypeError("network down");
    });

    const jobs = await fetchGreenhouse(["acme-systems", "unhappy"]);

    expect(jobs).toHaveLength(2);
    expect(fetchSpy.mock.calls).toHaveLength(3); // one ok board, one board retried once
    expect(errorLog).toHaveBeenCalledWith("source=greenhouse company=unhappy error=network down");
    expect(log).toHaveBeenCalledWith(
      "source=greenhouse in=2 companies out=2 failed=1",
    );
    log.mockRestore();
    errorLog.mockRestore();
  });

  test("an empty company list returns []", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    expect(await fetchGreenhouse([])).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("source=greenhouse in=0 companies out=0 failed=0");
    log.mockRestore();
  });
});
