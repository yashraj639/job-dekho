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
