import { z } from "zod";
import { fetchJson } from "./http";
import { errorMessage } from "./log";
import type { Job } from "./types";

export const MAX_MESSAGES_PER_RUN = 10;

export interface PlannedMessage {
  text: string;
  /** null for summary lines. */
  jobId: string | null;
}

/** Keep the alert short: role, company, location and the original listing link. */
export function formatJobMessage(job: Job): string {
  const location = job.location || (job.remote ? "Remote" : "location unknown");
  return [job.title, `${job.company} · ${location}`, job.url].join("\n");
}

export function formatResumeJobMessage(job: Job): string {
  return [`Resume match`, formatJobMessage(job)].join("\n");
}

export function formatOverflow(extra: number): string {
  return `+${extra} more, check logs.`;
}

export function formatNoResults(): string {
  return "⚠️ Every source returned 0 jobs today. That usually means something broke, not an empty market.";
}

/** Cap at 10 job messages, then one overflow line. Pure, so dry-run can preview it. */
export function planMessages(jobs: readonly Job[], resumeMatchIds: ReadonlySet<string> = new Set()): PlannedMessage[] {
  const plan: PlannedMessage[] = jobs
    .slice(0, MAX_MESSAGES_PER_RUN)
    .map((job) => ({
      text: resumeMatchIds.has(job.id) ? formatResumeJobMessage(job) : formatJobMessage(job),
      jobId: job.id,
    }));

  const extra = jobs.length - MAX_MESSAGES_PER_RUN;
  if (extra > 0) plan.push({ text: formatOverflow(extra), jobId: null });

  return plan;
}

export type PostMessage = (text: string) => Promise<void>;

/** Send everything, one failure at a time: a bad message must not stop the rest. */
export async function sendMessages(
  plan: readonly PlannedMessage[],
  post: PostMessage,
): Promise<{ sent: number; failed: number; sentJobIds: string[]; failedJobIds: string[] }> {
  let sent = 0;
  let failed = 0;
  const sentJobIds: string[] = [];
  const failedJobIds: string[] = [];

  for (const message of plan) {
    try {
      await post(message.text);
      sent++;
      if (message.jobId) sentJobIds.push(message.jobId);
    } catch (error) {
      failed++;
      if (message.jobId) failedJobIds.push(message.jobId);
      const label = message.jobId ? `job=${message.jobId}` : "summary";
      console.error(`telegram ${label} error=${errorMessage(error)}`);
    }
  }

  return { sent, failed, sentJobIds, failedJobIds };
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
