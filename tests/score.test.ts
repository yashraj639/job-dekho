import { describe, expect, spyOn, test } from "bun:test";
import { buildPrompt, scoreJob, type GenerateScore } from "../src/score";
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

  test("does not retry a quota error — it would eat tomorrow's quota too", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      throw new Error("429 You exceeded your current quota");
    };

    expect(await scoreJob(makeJob(), RESUME, generate)).toBeNull();
    expect(calls).toBe(1);
    errorLog.mockRestore();
  });

  test("does not retry a 429 status from the API client", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const generate: GenerateScore = async () => {
      calls++;
      throw Object.assign(new Error("resource exhausted"), { statusCode: 429 });
    };

    expect(await scoreJob(makeJob(), RESUME, generate)).toBeNull();
    expect(calls).toBe(1);
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
