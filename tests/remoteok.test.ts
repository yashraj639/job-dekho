import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fetchRemoteOk, normalizeRemoteOkJob, type RemoteOkJob, type RemoteOkJobInput } from "../src/sources/remoteok";
import { JobSchema } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "remoteok.json");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawJob(overrides: Partial<RemoteOkJobInput> = {}): RemoteOkJob {
  // Real listings sometimes carry numeric ids, so overrides are allowed to
  // express the pre-coercion shape; the cast is where checking stops.
  return { ...baseRemoteOkJob, ...overrides } as RemoteOkJob;
}

const baseRemoteOkJob = {
  id: "1137568",
  url: "https://remoteok.com/remote-jobs/remote-junior-full-stack-developer-1137568",
  position: "Junior Full Stack Developer",
  company: "Example Co",
  location: "Worldwide",
  date: "2026-10-24T00:00:02+00:00",
  description: "<p>Hello</p>",
};

describe("normalizeRemoteOkJob", () => {
  test("maps a RemoteOK listing onto the Job shape", () => {
    const job = normalizeRemoteOkJob(rawJob());

    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(job.id).toBe("remoteok:1137568");
    expect(job.source).toBe("remoteok");
    expect(job.company).toBe("Example Co");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBe("2026-10-24T00:00:02+00:00");
  });

  test("turns HTML into plain text and decodes entities", () => {
    const job = normalizeRemoteOkJob(
      rawJob({ description: "<p>React &amp; TypeScript &mdash; Node</p><ul><li>Remote</li></ul>" }),
    );

    expect(job.description).toBe("React & TypeScript — Node\nRemote");
    expect(job.description).not.toContain("<");
  });
});

describe("fetchRemoteOk", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  /** `typeof fetch` also carries `preconnect`, which a test stub never needs. */
  function mockFetch(impl: (input: unknown, init?: RequestInit) => Promise<Response>): void {
    fetchSpy.mockImplementation(impl as unknown as typeof fetch);
  }

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("normalizes the saved fixture into valid jobs, legal notice skipped", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async () => jsonResponse(fixture));

    const jobs = await fetchRemoteOk();

    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }
    expect(jobs[0]?.id).toBe("remoteok:1137568");
    expect(jobs[0]?.description).toContain("React & TypeScript");
    expect(jobs[1]?.postedAt).toBeNull();
    expect(log).toHaveBeenCalledWith("source=remoteok in=3 out=2 skipped=1");
    log.mockRestore();
  });

  test("sends a proper User-Agent header", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    let userAgent = "";
    mockFetch(async (input, init) => {
      const headers = (init?.headers ?? null) as Record<string, string> | null;
      userAgent = headers?.["User-Agent"] ?? "";
      return jsonResponse(fixture);
    });

    await fetchRemoteOk();
    log.mockRestore();

    expect(userAgent).toContain("job-dekho");
  });

  test("a dead network returns [] and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => {
      throw new TypeError("network down");
    });

    const jobs = await fetchRemoteOk();

    expect(jobs).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith("source=remoteok error=network down");
    errorLog.mockRestore();
  });

  test("an HTTP error returns [] and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => new Response("boom", { status: 403 }));

    const jobs = await fetchRemoteOk();

    expect(jobs).toEqual([]);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith("source=remoteok error=HTTP 403");
    errorLog.mockRestore();
  });

  test("one malformed listing is skipped, the rest survive", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    mockFetch(async () =>
      jsonResponse([
        { legal: "API terms: please link back to Remote OK." },
        rawJob({ id: "1" }),
        rawJob({ id: "2", url: "not-a-url" }),
        rawJob({ id: 3 }),
      ]),
    );

    const jobs = await fetchRemoteOk();

    expect(jobs.map((job) => job.id)).toEqual(["remoteok:1", "remoteok:3"]);
    expect(log).toHaveBeenCalledWith("source=remoteok in=4 out=2 skipped=2");
    log.mockRestore();
  });

  test("a non-array response returns [] with a one-line log", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => jsonResponse({ unexpected: true }));

    expect(await fetchRemoteOk()).toEqual([]);

    const logged = errorLog.mock.calls[0]?.[0];
    expect(typeof logged).toBe("string");
    expect(logged as string).toStartWith("source=remoteok error=");
    expect(logged as string).not.toContain("\n");
    errorLog.mockRestore();
  });
});
