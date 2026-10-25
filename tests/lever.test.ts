import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { fetchLever, normalizeLeverJob, type LeverJob } from "../src/sources/lever";
import { JobSchema } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "lever.json");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawJob(overrides: Partial<LeverJob> = {}): LeverJob {
  return {
    id: "2a55d6c9-c564-443a-be3e-a3851db5a93b",
    text: "Software Engineer - Junior Full Stack",
    hostedUrl: "https://jobs.lever.co/example-co/2a55d6c9-c564-443a-be3e-a3851db5a93b",
    createdAt: 1792767640768,
    workplaceType: "Remote",
    categories: { location: "Remote" },
    descriptionPlain: "Our stack is React, TypeScript and Node.js.",
    ...overrides,
  };
}

describe("normalizeLeverJob", () => {
  test("maps a Lever posting onto the Job shape", () => {
    const job = normalizeLeverJob(rawJob(), "example-co");

    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(job.id).toBe("lever:2a55d6c9-c564-443a-be3e-a3851db5a93b");
    expect(job.source).toBe("lever");
    expect(job.company).toBe("Example Co");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBe(new Date(1792767640768).toISOString());
    expect(job.description).toContain("React, TypeScript and Node.js");
  });

  test("missing createdAt and category location become null and empty", () => {
    const job = normalizeLeverJob(
      rawJob({ createdAt: null, workplaceType: null, categories: { location: null } }),
      "acme",
    );

    expect(job.postedAt).toBeNull();
    expect(job.location).toBe("");
    expect(job.remote).toBeNull();
  });

  test("an invalid createdAt epoch becomes null instead of a garbage date", () => {
    const job = normalizeLeverJob(rawJob({ createdAt: -1 }), "acme");

    expect(job.postedAt).toBeNull();
  });
});

describe("fetchLever", () => {
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

    const jobs = await fetchLever(["acme-systems"]);
    log.mockRestore();

    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(JobSchema.safeParse(job).success).toBe(true);
    }
    expect(jobs[0]?.company).toBe("Acme Systems");
    expect(jobs[0]?.location).toBe("Remote");
    expect(jobs[1]?.location).toBe("Bengaluru, India");
    expect(jobs[1]?.remote).toBeNull();
  });

  test("one failing board does not take the others down", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const fixture = await Bun.file(FIXTURE_PATH).json();
    mockFetch(async (input) => {
      const url = String(input);
      if (!url.includes("/postings/unhappy")) {
        return jsonResponse(fixture);
      }
      throw new TypeError("network down");
    });

    const jobs = await fetchLever(["acme-systems", "unhappy"]);

    expect(jobs).toHaveLength(2);
    expect(fetchSpy.mock.calls).toHaveLength(3); // one ok board, one board retried once
    expect(errorLog).toHaveBeenCalledWith("source=lever company=unhappy error=network down");
    expect(log).toHaveBeenCalledWith("source=lever in=2 companies out=2 failed=1");
    log.mockRestore();
    errorLog.mockRestore();
  });

  test("one malformed posting is skipped, the rest survive", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    mockFetch(async () =>
      jsonResponse([rawJob({ id: "a" }), rawJob({ id: "b", hostedUrl: "not-a-url" }), rawJob({ id: "c" })]),
    );

    const jobs = await fetchLever(["acme-systems"]);

    expect(jobs.map((job) => job.id)).toEqual(["lever:a", "lever:c"]);
    expect(log).toHaveBeenCalledWith(
      "source=lever company=acme-systems in=3 out=2 skipped=1",
    );
    log.mockRestore();
  });
});
