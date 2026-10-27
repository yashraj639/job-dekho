import { z } from "zod";

export const JobSchema = z.object({
  id: z.string(), // `${source}:${sourceId}`, globally unique
  source: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().default(""),
  remote: z.boolean().nullable(),
  url: z.string().url(),
  description: z.string(), // plain text, truncated to ~6000 chars
  postedAt: z.string().nullable(), // ISO date if the source provides it
});
export type Job = z.infer<typeof JobSchema>;

export const ScoreSchema = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum(["apply", "maybe", "skip"]),
  // No max on reason, on purpose: Gemini's structured output ignores length
  // hints, so every cap we tried (240, 400) made verbose listings fail
  // validation and silently drop the job, model determinism knowing exactly
  // which ones every run. Length really is a display concern; Telegram's
  // per-message limit guards message size at format time.
  reason: z.string(),
  matchedSkills: z.array(z.string()),
  redFlags: z.array(z.string()),
});
export type Score = z.infer<typeof ScoreSchema>;
