import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  MAX_MESSAGES_PER_RUN,
  createTelegramPost,
  formatJobMessage,
  formatResumeJobMessage,
  formatNoResults,
  formatOverflow,
  planMessages,
  sendMessages,
} from "../src/notify";
import { makeJob } from "./helpers";

function makeMatches(count: number) {
  return Array.from({ length: count }, (_, index) => makeJob({ id: `remotive:${index}` }));
}

describe("formatJobMessage", () => {
  test("shows the role, company, location and direct listing link", () => {
    const job = makeJob({
      title: "Full-Stack AI Intern",
      location: "Remote",
      url: "https://example.com/job",
    });
    const message = formatJobMessage(job);

    expect(message).toBe(
      [
        "Full-Stack AI Intern",
        "Productiv Team · Remote",
        "https://example.com/job",
      ].join("\n"),
    );
  });

  test("falls back to Remote, then to location unknown", () => {
    expect(formatJobMessage(makeJob({ location: "" }))).toContain("Productiv Team · Remote");
    expect(
      formatJobMessage(makeJob({ location: "", remote: false })),
    ).toContain("Productiv Team · location unknown");
  });
});

test("resume alerts are clearly labeled while keeping the short job layout", () => {
  const job = makeJob({ id: "resume:1", title: "Backend Engineer" });

  expect(formatResumeJobMessage(job)).toBe(`Resume match\n${formatJobMessage(job)}`);
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

  test("labels only resume-specific extra jobs", () => {
    const general = makeJob({ id: "general:1" });
    const resumeOnly = makeJob({ id: "resume:1" });
    const plan = planMessages([general, resumeOnly], new Set([resumeOnly.id]));

    expect(plan[0]?.text).not.toStartWith("Resume match");
    expect(plan[1]?.text).toStartWith("Resume match");
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

    expect(result).toEqual({
      sent: 2,
      failed: 0,
      sentJobIds: ["remotive:0", "remotive:1"],
      failedJobIds: [],
    });
    expect(posted[0]).toContain("Junior Full Stack Developer");
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
    expect(result.sentJobIds).toEqual(["remotive:1", "remotive:2"]);
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
    expect(result.sentJobIds).toHaveLength(10);
    expect(result.failedJobIds).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith("telegram summary error=rate limited");
    errorLog.mockRestore();
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
