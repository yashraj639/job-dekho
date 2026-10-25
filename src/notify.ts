import { z } from "zod";
import { fetchJson } from "./http";
import { errorMessage } from "./log";
import type { Job, Score } from "./types";

export const MAX_MESSAGES_PER_RUN = 10;

/**
 * Heartbeat day. Stateless on purpose: a missed Monday heartbeat means the
 * scheduled run did not happen, which is exactly what we want to learn.
 * CI runs in UTC, so this is Monday UTC.
 */
export const HEARTBEAT_WEEKDAY = 1;

export interface Match {
  job: Job;
  score: Score;
}

export interface PlannedMessage {
  text: string;
  /** null for summary lines (overflow, heartbeat, alerts). */
  jobId: string | null;
}

/** The exact shape from SPEC.md §9. Plain text, so titles cannot break formatting. */
export function formatJobMessage(job: Job, score: Score): string {
  const location = job.location || (job.remote ? "Remote" : "location unknown");
  const lines = [
    `🟢 ${score.score.toFixed(1)}/10  ${job.title}`,
    `${job.company} · ${location}`,
    `Why: ${score.reason}`,
  ];
  if (score.redFlags.length > 0) lines.push(`Flags: ${score.redFlags.join(", ")}`);
  lines.push(job.url);
  return lines.join("\n");
}

export function formatOverflow(extra: number): string {
  return `+${extra} more, check logs.`;
}

export function formatHeartbeat(fetched: number, scored: number): string {
  return `0 new matches this week. Pipeline is alive: fetched ${fetched}, scored ${scored}.`;
}

export function formatNoResults(): string {
  return "⚠️ Every source returned 0 jobs today. That usually means something broke, not an empty market.";
}

export function shouldSendHeartbeat(now: Date): boolean {
  return now.getDay() === HEARTBEAT_WEEKDAY;
}

/** Cap at 10 job messages, then one overflow line. Pure, so dry-run can preview it. */
export function planMessages(matches: readonly Match[]): PlannedMessage[] {
  const plan: PlannedMessage[] = matches
    .slice(0, MAX_MESSAGES_PER_RUN)
    .map((match) => ({ text: formatJobMessage(match.job, match.score), jobId: match.job.id }));

  const extra = matches.length - MAX_MESSAGES_PER_RUN;
  if (extra > 0) plan.push({ text: formatOverflow(extra), jobId: null });

  return plan;
}

export type PostMessage = (text: string) => Promise<void>;

/** Send everything, one failure at a time: a bad message must not stop the rest. */
export async function sendMessages(
  plan: readonly PlannedMessage[],
  post: PostMessage,
): Promise<{ sent: number; failed: number; failedJobIds: string[] }> {
  let sent = 0;
  let failed = 0;
  const failedJobIds: string[] = [];

  for (const message of plan) {
    try {
      await post(message.text);
      sent++;
    } catch (error) {
      failed++;
      if (message.jobId) failedJobIds.push(message.jobId);
      const label = message.jobId ? `job=${message.jobId}` : "summary";
      console.error(`telegram ${label} error=${errorMessage(error)}`);
    }
  }

  return { sent, failed, failedJobIds };
}

const TelegramResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

/**
 * Real transport. Reads the token from env and scrubs it from any error,
 * because that string must never reach a log.
 */
export function createTelegramPost(): PostMessage {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return async (text) => {
    let response: z.infer<typeof TelegramResponseSchema>;
    try {
      response = await fetchJson(url, TelegramResponseSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (error) {
      throw new Error(errorMessage(error).replaceAll(token, "<token>"));
    }

    if (!response.ok) {
      throw new Error(response.description ?? "telegram rejected the message");
    }
  };
}
