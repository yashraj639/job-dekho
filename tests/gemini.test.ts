import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { buildGeminiPrompt, fetchGemini, normalizeGeminiJobs } from "../src/sources/gemini";
import { JobSchema } from "../src/types";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const result = {
  title: "Junior AI Engineer",
  company: "Example Co",
  location: "Remote (India)",
  remoteFromIndia: true,
  applicationUrl: "https://example.com/careers/ai-engineer",
  postedAt: "2026-11-01T08:00:00Z",
  description: "Build AI features with TypeScript and React.",
};

describe("Gemini discovery", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  const previousKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });

  test("normalizes the model's JSON jobs", () => {
    const jobs = normalizeGeminiJobs([result]);

    expect(jobs).toHaveLength(1);
    expect(JobSchema.safeParse(jobs[0]).success).toBe(true);
    expect(jobs[0]?.source).toBe("gemini");
    expect(jobs[0]?.remote).toBe(true);
  });

  test("drops aggregator application links even when Gemini returns them", () => {
    expect(normalizeGeminiJobs([{ ...result, applicationUrl: "https://www.linkedin.com/jobs/view/1" }])).toEqual([]);
  });

  test("asks Gemini to search fresh roles and return direct links", () => {
    const prompt = buildGeminiPrompt(new Date("2026-11-01T08:00:00Z"));

    expect(prompt).toContain("within the last 24 hours");
    expect(prompt).toContain("remotely from India");
    expect(prompt).toContain("ONLY a JSON array");
    expect(prompt).toContain("direct application URLs");
  });

  test("reads an interactions response and returns jobs", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    fetchSpy.mockResolvedValue(
      jsonResponse({
        steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify([result]) }] }],
      }),
    );

    const jobs = await fetchGemini(new Date("2026-11-01T08:00:00Z"));

    expect(jobs[0]?.title).toBe("Junior AI Engineer");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("source=gemini out=1");
    log.mockRestore();
  });
});
