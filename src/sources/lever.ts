import { z } from "zod";
import { displayCompany, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";
import { fetchBoards } from "./boardFetch";

const SOURCE = "lever";

const LeverJobSchema = z.object({
  id: z.string(),
  text: z.string(), // the posting title
  hostedUrl: z.string(),
  createdAt: z.number().nullish(), // epoch milliseconds
  workplaceType: z.string().nullish(),
  categories: z.object({ location: z.string().nullish() }).nullish(),
  descriptionPlain: z.string().nullish(), // already plain text, unlike Greenhouse
});
export type LeverJob = z.infer<typeof LeverJobSchema>;

const LeverResponseSchema = z.array(LeverJobSchema);

export function normalizeLeverJob(raw: LeverJob, slug: string): Job {
  const location = raw.categories?.location ?? "";
  const posted = raw.createdAt !== null && raw.createdAt !== undefined && raw.createdAt > 0
    ? new Date(raw.createdAt)
    : null;
  const postedIso = posted !== null && Number.isFinite(posted.valueOf())
    ? posted.toISOString()
    : null;
  const remote = /remote/i.test(`${raw.workplaceType ?? ""} ${location}`);

  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.text.trim(),
    company: displayCompany(slug),
    location: location.trim(),
    remote: remote ? true : null,
    url: raw.hostedUrl,
    description: truncateDescription(raw.descriptionPlain ?? ""),
    postedAt: postedIso,
  });
}

export function fetchLever(slugs: readonly string[]): Promise<Job[]> {
  return fetchBoards(
    {
      source: SOURCE,
      url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
      schema: LeverResponseSchema,
      postings: (data) => data,
      normalize: normalizeLeverJob,
    },
    slugs,
  );
}
