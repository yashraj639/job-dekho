import { z } from "zod";
import { fetchJson } from "../http";
import { errorMessage } from "../log";
import { stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

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

/** "acme-systems" -> "Acme Systems"; keeps the slug readable for the alert. */
export function displayCompany(slug: string): string {
  return slug
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

function fetchBoardFor(slug: string): Promise<Job[]> {
  return fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    GreenhouseResponseSchema,
  ).then((data) => {
    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of data.jobs) {
      try {
        jobs.push(normalizeGreenhouseJob(raw, slug));
      } catch {
        skipped++; // one bad listing must not take the board down
      }
    }
    console.log(`source=${SOURCE} company=${slug} in=${data.jobs.length} out=${jobs.length} skipped=${skipped}`);
    return jobs;
  });
}

export async function fetchGreenhouse(slugs: readonly string[]): Promise<Job[]> {
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
