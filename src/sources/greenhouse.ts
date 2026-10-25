import { z } from "zod";
import { displayCompany, stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";
import { fetchBoards } from "./boardFetch";

const SOURCE = "greenhouse";

const GreenhouseJobSchema = z.object({
  id: z.coerce.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string() }).nullish(),
  content: z.string().nullish(), // HTML body, present because of ?content=true
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

const GreenhouseResponseSchema = z.object({ jobs: z.array(GreenhouseJobSchema) });

export function normalizeGreenhouseJob(raw: GreenhouseJob, slug: string): Job {
  const location = raw.location?.name ?? "";
  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.title.trim(),
    company: displayCompany(slug),
    location: location.trim(),
    remote: /remote|anywhere/i.test(location) ? true : null,
    url: raw.absolute_url,
    description: truncateDescription(stripHtml(raw.content ?? "")),
    postedAt: raw.first_published ?? raw.updated_at ?? null,
  });
}

export function fetchGreenhouse(slugs: readonly string[]): Promise<Job[]> {
  return fetchBoards(
    {
      source: SOURCE,
      url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      schema: GreenhouseResponseSchema,
      postings: (data) => data.jobs,
      normalize: normalizeGreenhouseJob,
    },
    slugs,
  );
}
