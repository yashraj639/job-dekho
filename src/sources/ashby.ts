import { z } from "zod";
import { displayCompany, stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";
import { fetchBoards } from "./boardFetch";

const SOURCE = "ashby";

const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  location: z.string().default(""),
  isRemote: z.boolean().nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(), // unlisted drafts must not leak into the pipeline
  descriptionHtml: z.string().nullish(),
});
export type AshbyJob = z.infer<typeof AshbyJobSchema>;

const AshbyResponseSchema = z.object({ jobs: z.array(AshbyJobSchema) });

export function normalizeAshbyJob(raw: AshbyJob, slug: string): Job | null {
  if (raw.isListed === false) return null;

  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.title.trim(),
    company: displayCompany(slug),
    location: raw.location.trim(),
    remote: raw.isRemote ?? null,
    url: raw.jobUrl,
    description: truncateDescription(stripHtml(raw.descriptionHtml ?? "")),
    postedAt: raw.publishedAt ?? null,
  });
}

export function fetchAshby(slugs: readonly string[]): Promise<Job[]> {
  return fetchBoards(
    {
      source: SOURCE,
      url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      schema: AshbyResponseSchema,
      postings: (data) => data.jobs,
      normalize: normalizeAshbyJob,
    },
    slugs,
  );
}
