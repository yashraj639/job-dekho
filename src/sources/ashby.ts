import { z } from "zod";
import { fetchJson } from "../http";
import { errorMessage } from "../log";
import { stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

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

function displayCompanyAshby(slug: string): string {
  return slug
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeAshbyJob(raw: AshbyJob, slug: string): Job | null {
  if (raw.isListed === false) return null;

  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.title.trim(),
    company: displayCompanyAshby(slug),
    location: raw.location.trim(),
    remote: raw.isRemote ?? null,
    url: raw.jobUrl,
    description: truncateDescription(stripHtml(raw.descriptionHtml ?? "")),
    postedAt: raw.publishedAt ?? null,
  });
}

function fetchBoardFor(slug: string): Promise<Job[]> {
  return fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    AshbyResponseSchema,
  ).then((data) => {
    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of data.jobs) {
      try {
        const job = normalizeAshbyJob(raw, slug);
        if (job === null) throw new Error("unlisted posting");
        jobs.push(job);
      } catch {
        skipped++; // one bad listing must not take the board down
      }
    }
    console.log(`source=${SOURCE} company=${slug} in=${data.jobs.length} out=${jobs.length} skipped=${skipped}`);
    return jobs;
  });
}

export async function fetchAshby(slugs: readonly string[]): Promise<Job[]> {
  const results = await Promise.allSettled(slugs.map(fetchBoardFor));

  const jobs: Job[] = [];
  let failed = 0;
  results.forEach((result, index) => {
    const slug = slugs[index] ?? "(unknown)";
    if (result.status === "rejected") {
      failed++;
      console.error(`source=${SOURCE} company=${slug} error=${errorMessage(result.reason)}`);
    } else {
      jobs.push(...result.value);
    }
  });

  console.log(`source=${SOURCE} in=${slugs.length} companies out=${jobs.length} failed=${failed}`);
  return jobs;
}
