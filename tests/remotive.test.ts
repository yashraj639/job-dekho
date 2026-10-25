import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { MAX_DESCRIPTION_CHARS } from "../src/normalize";
import { fetchRemotive, normalizeRemotiveJob, type RemotiveJob } from "../src/sources/remotive";
import { JobSchema } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "remotive.json");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawJob(overrides: Partial<RemotiveJob> = {}): RemotiveJob {
  return {
    id: 1,
    url: "https://remotive.com/remote-jobs/software-dev/example-1",
    title: "Junior Developer",
    company_name: "Example Co",
    candidate_required_location: "Worldwide",
    publication_date: "2026-10-20T09:12:00",
    description: "<p>Hello</p>",
    ...overrides,
  };
}

describe("normalizeRemotiveJob", () => {
  test("maps a Remotive listing onto the Job shape", () => {
    const job = normalizeRemotiveJob(rawJob());

    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(job.id).toBe("remotive:1");
    expect(job.source).toBe("remotive");
    expect(job.company).toBe("Example Co");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBe("2026-10-20T09:12:00");
  });

  test("turns HTML into plain text and decodes entities", () => {
    const job = normalizeRemotiveJob(
      rawJob({ description: "<p>React &amp; TypeScript &mdash; Node</p><ul><li>Remote</li></ul>" }),
    );

    expect(job.description).toBe("React & TypeScript — Node\nRemote");
    expect(job.description).not.toContain("<");
  });

  test("caps the description length", () => {
    const job = normalizeRemotiveJob(rawJob({ description: "a".repeat(MAX_DESCRIPTION_CHARS + 500) }));

    expect(job.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(job.description.endsWith("…")).toBe(true);
  });

  test("missing publication date becomes null", () => {
    const job = normalizeRemotiveJob(rawJob({ publication_date: undefined }));
    expect(job.postedAt).toBeNull();
  });
});

describe("fetchRemotive", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  /** `typeof fetch` also carries `preconnect`, which a test stub never needs. */
  function mockFetch(impl: () => Promise<Response>): void {
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

    const jobs = await fetchRemotive();
    log.mockRestore();

    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }
    expect(jobs[0]?.id).toBe("remotive:1928374");
    expect(jobs[0]?.description).toContain("React & TypeScript");
    expect(jobs[1]?.postedAt).toBeNull();
    expect(jobs[1]?.location).toBe("APAC");
  });

  test("a dead network returns [] and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => {
      throw new TypeError("network down");
    });

    const jobs = await fetchRemotive();

    expect(jobs).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith("source=remotive error=network down");
    errorLog.mockRestore();
  });

  test("an HTTP error returns [] and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => new Response("boom", { status: 500 }));

    const jobs = await fetchRemotive();

    expect(jobs).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith("source=remotive error=HTTP 500");
    errorLog.mockRestore();
  });

  test("one malformed listing is skipped, the rest survive", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    mockFetch(async () =>
      jsonResponse({
        jobs: [rawJob({ id: 1 }), rawJob({ id: 2, url: "not-a-url" }), rawJob({ id: 3 })],
      }),
    );

    const jobs = await fetchRemotive();

    expect(jobs.map((job) => job.id)).toEqual(["remotive:1", "remotive:3"]);
    expect(log).toHaveBeenCalledWith("source=remotive in=3 out=2 skipped=1");
    log.mockRestore();
  });

  test("a response missing the jobs array returns [] with a one-line log", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => jsonResponse({ unexpected: true }));

    expect(await fetchRemotive()).toEqual([]);

    const logged = errorLog.mock.calls[0]?.[0];
    expect(typeof logged).toBe("string");
    expect(logged as string).toStartWith("source=remotive error=jobs:");
    expect(logged as string).not.toContain("\n");
    errorLog.mockRestore();
  });
});
