import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fetchAshby, normalizeAshbyJob, type AshbyJob } from "../src/sources/ashby";
import { JobSchema } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "ashby.json");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawJob(overrides: Partial<AshbyJob> = {}): AshbyJob {
  return {
    id: "d3bc1ced-3ce4-4086-a050-555055dbb1ff",
    title: "Junior Fullstack Engineer",
    jobUrl: "https://jobs.ashbyhq.com/example-co/d3bc1ced-3ce4-4086-a050-555055dbb1ff",
    location: "Europe",
    isRemote: true,
    publishedAt: "2026-10-20T09:12:00.000Z",
    isListed: true,
    descriptionHtml: "<p>We are looking for a <strong>Junior Fullstack Engineer</strong>.</p>",
    ...overrides,
  };
}

describe("normalizeAshbyJob", () => {
  test("maps an Ashby posting onto the Job shape", () => {
    const job = normalizeAshbyJob(rawJob(), "example-co");

    expect(job).not.toBeNull();
    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(job?.id).toBe("ashby:d3bc1ced-3ce4-4086-a050-555055dbb1ff");
    expect(job?.source).toBe("ashby");
    expect(job?.company).toBe("Example Co");
    expect(job?.remote).toBe(true);
    expect(job?.postedAt).toBe("2026-10-20T09:12:00.000Z");
    expect(job?.description).toContain("Junior Fullstack Engineer");
  });

  test("missing fields become null and empty", () => {
    const job = normalizeAshbyJob(
      rawJob({ isRemote: null, location: "", publishedAt: null, descriptionHtml: null }),
      "acme",
    );

    expect(job?.remote).toBeNull();
    expect(job?.location).toBe("");
    expect(job?.postedAt).toBeNull();
    expect(job?.description).toBe("");
  });

  test("unlisted postings are dropped", () => {
    expect(normalizeAshbyJob(rawJob({ isListed: false }), "acme")).toBeNull();
  });
});

describe("fetchAshby", () => {
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

  test("normalizes the saved fixture into valid jobs, unlisted posting skipped", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async () => jsonResponse(fixture));

    const jobs = await fetchAshby(["acme-systems"]);

    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }
    expect(jobs[0]?.company).toBe("Acme Systems");
    expect(jobs[0]?.location).toBe("Europe");
    expect(log).toHaveBeenCalledWith(
      "source=ashby company=acme-systems in=3 out=2 skipped=1",
    );
    log.mockRestore();
  });

  test("one failing board does not take the others down", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async (input) => {
      const url = String(input);
      if (!url.includes("/job-board/angry")) return jsonResponse(fixture);
      throw new TypeError("network down");
    });

    const jobs = await fetchAshby(["angry", "acme-systems"]);

    expect(jobs).toHaveLength(2);
    expect(fetchSpy.mock.calls).toHaveLength(3); // one ok board, one board retried once
    expect(errorLog).toHaveBeenCalledWith("source=ashby company=angry error=network down");
    expect(log).toHaveBeenCalledWith("source=ashby in=2 companies out=2 failed=1");
    log.mockRestore();
    errorLog.mockRestore();
  });
});
