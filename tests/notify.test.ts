import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  MAX_MESSAGES_PER_RUN,
  createTelegramPost,
  formatHeartbeat,
  formatJobMessage,
  formatNoResults,
  formatOverflow,
  planMessages,
  sendMessages,
  shouldSendHeartbeat,
  type Match,
} from "../src/notify";
import type { Job, Score } from "../src/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "remotive:1",
    source: "remotive",
    title: "Junior Full-Stack Developer",
    company: "Productiv Team",
    location: "Remote",
    remote: true,
    url: "https://example.com/job",
    description: "React and TypeScript.",
    postedAt: "2026-10-20T09:12:00",
    ...overrides,
  };
}

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    score: 8.5,
    verdict: "apply",
    reason: "Next.js + TS + Claude pipeline, matches OpenLabs work",
    matchedSkills: ["next.js"],
    redFlags: ["part-time", "PST overlap needed"],
    ...overrides,
  };
}

function makeMatches(count: number): Match[] {
  return Array.from({ length: count }, (_, index) => ({
    job: makeJob({ id: `remotive:${index}` }),
    score: makeScore(),
  }));
}

describe("formatJobMessage", () => {
  test("matches the SPEC.md §9 layout exactly", () => {
    const message = formatJobMessage(makeJob(), makeScore());

    expect(message).toBe(
      [
        "🟢 8.5/10  Junior Full-Stack Developer",
        "Productiv Team · Remote",
        "Why: Next.js + TS + Claude pipeline, matches OpenLabs work",
        "Flags: part-time, PST overlap needed",
        "https://example.com/job",
      ].join("\n"),
    );
  });

  test("drops the Flags line when there are none", () => {
    const message = formatJobMessage(makeJob(), makeScore({ redFlags: [] }));

    expect(message).not.toContain("Flags:");
    expect(message.split("\n")).toHaveLength(4);
  });

  test("falls back to Remote, then to location unknown", () => {
    expect(formatJobMessage(makeJob({ location: "" }), makeScore())).toContain("Productiv Team · Remote");
    expect(
      formatJobMessage(makeJob({ location: "", remote: false }), makeScore()),
    ).toContain("Productiv Team · location unknown");
  });

  test("rounds the score to one decimal", () => {
    expect(formatJobMessage(makeJob(), makeScore({ score: 7 }))).toStartWith("🟢 7.0/10");
  });
});

describe("planMessages", () => {
  test("one message per job when under the cap", () => {
    const plan = planMessages(makeMatches(3));

    expect(plan).toHaveLength(3);
    expect(plan.map((message) => message.jobId)).toEqual([
      "remotive:0",
      "remotive:1",
      "remotive:2",
    ]);
  });

  test("caps at 10 and adds one overflow line", () => {
    const plan = planMessages(makeMatches(14));

    expect(plan).toHaveLength(MAX_MESSAGES_PER_RUN + 1);
    expect(plan.at(-1)?.text).toBe("+4 more, check logs.");
    expect(plan.at(-1)?.jobId).toBeNull();
  });

  test("no overflow line at exactly the cap", () => {
    const plan = planMessages(makeMatches(MAX_MESSAGES_PER_RUN));

    expect(plan).toHaveLength(MAX_MESSAGES_PER_RUN);
    expect(plan.some((message) => message.text.includes("more, check logs"))).toBe(false);
  });

  test("no messages for no matches", () => {
    expect(planMessages([])).toEqual([]);
  });

  test("overflow text is the exact spec string", () => {
    expect(formatOverflow(4)).toBe("+4 more, check logs.");
  });
});

describe("sendMessages", () => {
  test("posts every message in order", async () => {
    const posted: string[] = [];
    const post = async (text: string) => {
      posted.push(text);
    };

    const result = await sendMessages(planMessages(makeMatches(2)), post);

    expect(result).toEqual({ sent: 2, failed: 0, failedJobIds: [] });
    expect(posted[0]).toContain("🟢 8.5/10");
    expect(posted).toHaveLength(2);
  });

  test("keeps going after a failure and reports the failed job", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const post = async () => {
      call++;
      if (call === 1) throw new Error("chat not found");
    };

    const result = await sendMessages(planMessages(makeMatches(3)), post);

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failedJobIds).toEqual(["remotive:0"]);
    expect(errorLog).toHaveBeenCalledWith("telegram job=remotive:0 error=chat not found");
    errorLog.mockRestore();
  });

  test("labels an overflow failure as a summary line", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const post = async (text: string) => {
      if (text.includes("more, check logs")) throw new Error("rate limited");
    };

    const result = await sendMessages(planMessages(makeMatches(12)), post);

    expect(result.failed).toBe(1);
    expect(result.failedJobIds).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith("telegram summary error=rate limited");
    errorLog.mockRestore();
  });
});

describe("heartbeat", () => {
  test("fires on Monday only", () => {
    expect(shouldSendHeartbeat(new Date("2026-10-26T02:30:00Z"))).toBe(true);
    expect(shouldSendHeartbeat(new Date("2026-10-25T02:30:00Z"))).toBe(false);
    expect(shouldSendHeartbeat(new Date("2026-10-30T02:30:00Z"))).toBe(false);
  });

  test("says nothing matched and proves the run happened", () => {
    const message = formatHeartbeat(10, 1);

    expect(message).toContain("0 new matches");
    expect(message).toContain("fetched 10");
    expect(message).toContain("scored 1");
  });
});

describe("formatNoResults", () => {
  test("frames zero results as a breakage", () => {
    expect(formatNoResults()).toContain("0 jobs");
    expect(formatNoResults()).toContain("broke");
  });
});

describe("createTelegramPost", () => {
  const TOKEN = "123456:FAKE_TOKEN_VALUE";
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  function mockFetch(impl: () => Promise<Response>): void {
    fetchSpy.mockImplementation(impl as unknown as typeof fetch);
  }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = "42";
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("posts the text and chat id to the bot endpoint", async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));

    await createTelegramPost()("hello");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ chat_id: "42", text: "hello" });
  });

  test("throws the Telegram description when the API says no", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }),
    );

    await expect(createTelegramPost()("hello")).rejects.toThrow("chat not found");
  });

  test("never leaks the token into an error message", async () => {
    mockFetch(async () => {
      throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });

    let message = "";
    try {
      await createTelegramPost()("hello");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("<token>");
    expect(message).not.toContain(TOKEN);
  });

  test("refuses to build a poster without credentials", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => createTelegramPost()).toThrow("TELEGRAM_BOT_TOKEN is not set");
  });
});
