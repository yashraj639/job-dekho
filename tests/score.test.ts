import { describe, expect, spyOn, test } from "bun:test";
import {
  buildPrompt,
  extractQuotaRetryMs,
  scoreJob,
  type GenerateScore,
} from "../src/score";
import type { Score } from "../src/types";
import { makeJob } from "./helpers";

const RESUME = "SECRET_RESUME_MARKER: built a Next.js app at OpenLabs.";

function validScore(overrides: Partial<Score> = {}): Score {
  return {
    score: 8.5,
    verdict: "apply",
    reason: "Next.js and TypeScript match the OpenLabs work.",
    matchedSkills: ["next.js", "typescript"],
    redFlags: [],
    ...overrides,
  };
}

describe("buildPrompt", () => {
  test("includes the resume, the listing and the seniority instruction", () => {
    const { system, prompt } = buildPrompt(makeJob(), RESUME);

    expect(prompt).toContain(RESUME);
    expect(prompt).toContain("Junior Full Stack Developer");
    expect(prompt).toContain("Productiv Team");
    expect(prompt).toContain("React and TypeScript");
    expect(system).toContain("Be blunt and realistic");
    expect(system).toContain("Return only the structured object requested.");
  });

  test("labels the listing as untrusted data", () => {
    const { prompt } = buildPrompt(makeJob(), RESUME);

    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("<listing>");
    expect(prompt).toContain("</listing>");
  });

  test("caps the description at 6000 chars", () => {
    const { prompt } = buildPrompt(makeJob({ description: "a".repeat(9000) }), RESUME);

    const listing = prompt.slice(prompt.indexOf("<listing>"), prompt.indexOf("</listing>"));
    expect(listing.length).toBeLessThan(6500);
  });

  test("handles an unknown remote flag and an empty location", () => {
    const { prompt } = buildPrompt(makeJob({ remote: null, location: "" }), RESUME);

    expect(prompt).toContain("Location: unknown");
    expect(prompt).toContain("Remote: unknown");
  });
});

describe("scoreJob", () => {
  test("returns the score when the model behaves", async () => {
    const generate: GenerateScore = async () => validScore();

    expect(await scoreJob(makeJob(), RESUME, generate)).toEqual(validScore());
  });

  test("retries once and succeeds on the second attempt", async () => {
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      if (calls === 1) throw new Error("network reset");
      return validScore();
    };

    expect(await scoreJob(makeJob(), RESUME, generate)).toEqual(validScore());
    expect(calls).toBe(2);
  });

  test("waits out a quota error and retries once", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const sleeps: number[] = [];
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("quota exceeded"), { statusCode: 429 });
      return validScore();
    };

    const result = await scoreJob(makeJob(), RESUME, generate, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    expect(result).toEqual(validScore());
    expect(calls).toBe(2);
    expect(sleeps).toEqual([60_000]); // no retry window stated: default
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  test("waits only once for quota errors, then gives up", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const sleeps: number[] = [];
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      throw Object.assign(new Error("429 resource exhausted, retry in 30s"), { statusCode: 429 });
    };

    const result = await scoreJob(makeJob(), RESUME, generate, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    expect(result).toBeNull();
    expect(calls).toBe(3); // 2 normal attempts + 1 quota retry, no second sleep
    expect(sleeps).toEqual([30_000]);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  test("non-quota errors never trigger the quota wait", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const sleeps: number[] = [];
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      throw new Error("network reset");
    };

    await scoreJob(makeJob(), RESUME, generate, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([]);
    errorLog.mockRestore();
  });

  test("retries once when the output fails validation", async () => {
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      return calls === 1 ? validScore({ score: 11 }) : validScore();
    };

    expect((await scoreJob(makeJob(), RESUME, generate))?.score).toBe(8.5);
    expect(calls).toBe(2);
  });

  test("gives up after two failures and returns null", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      throw new Error("model exploded");
    };

    expect(await scoreJob(makeJob(), RESUME, generate)).toBeNull();
    expect(calls).toBe(2);
    expect(errorLog).toHaveBeenCalledWith("score job=remotive:1 skipped error=model exploded");
    errorLog.mockRestore();
  });

  test("gives up when the model keeps returning invalid output", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const generate: GenerateScore = async () => ({ score: "nine", verdict: "apply" });

    expect(await scoreJob(makeJob(), RESUME, generate)).toBeNull();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  test("never puts the resume in a log line", async () => {
    const logged: string[] = [];
    const errorLog = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    const generate: GenerateScore = async () => {
      throw new Error("boom");
    };

    await scoreJob(makeJob(), RESUME, generate);

    expect(logged.join("\n")).not.toContain("SECRET_RESUME_MARKER");
    errorLog.mockRestore();
  });

  test("passes the built prompt straight through to the model", async () => {
    const inputs: { system: string; prompt: string }[] = [];
    const generate: GenerateScore = async (input) => {
      inputs.push(input);
      return validScore();
    };

    await scoreJob(makeJob(), RESUME, generate);

    expect(inputs).toEqual([buildPrompt(makeJob(), RESUME)]);
  });
});

describe("extractQuotaRetryMs", () => {
  test("parses the retry window out of the real Gemini error text", () => {
    const error = new Error(
      "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_requests, " +
        "limit: 15 ... See https://ai.dev/rate-limit. * Quota exceeded ... " +
        "Please retry in 58.915856825s.",
    );
    expect(extractQuotaRetryMs(error)).toBeCloseTo(58_916, -3);
  });

  test("defaults to 60s when no window is stated", () => {
    expect(extractQuotaRetryMs(new Error("429 You exceeded your current quota"))).toBe(60_000);
    expect(extractQuotaRetryMs(undefined)).toBe(60_000);
    expect(extractQuotaRetryMs(new Error("retry in soon"))).toBe(60_000);
    expect(extractQuotaRetryMs(new Error("retry in NaNs"))).toBe(60_000);
    expect(extractQuotaRetryMs({ notAnError: true })).toBe(60_000);
  });

  test("caps nonsense windows at 90s", () => {
    expect(extractQuotaRetryMs(new Error("Please retry in 300s."))).toBe(90_000);
  });
});
