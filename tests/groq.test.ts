import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { fetchGroq } from "../src/sources/groq";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const job = {
  title: "Junior AI Engineer",
  company: "Example Co",
  location: "Remote (India)",
  remoteFromIndia: true,
  applicationUrl: "https://example.com/careers/ai-engineer",
  postedAt: "2026-11-01T08:00:00Z",
  description: "Build AI features with TypeScript and React.",
};

describe("Groq discovery", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  const previousKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  });

  test("reads browser-search JSON and tags the jobs as Groq", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: JSON.stringify([job]) } }] }),
    );

    const jobs = await fetchGroq(new Date("2026-11-01T08:00:00Z"));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.source).toBe("groq");
    expect(jobs[0]?.id).toBe("groq:https://example.com/careers/ai-engineer");
    expect(log).toHaveBeenCalledWith("source=groq out=1");
    log.mockRestore();
  });
});
