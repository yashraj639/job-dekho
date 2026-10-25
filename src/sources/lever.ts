import { z } from "zod";
import { fetchJson } from "../http";
import { errorMessage } from "../log";
import { truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

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
    company: displayCompanyLever(slug),
    location: location.trim(),
    remote: remote ? true : null,
    url: raw.hostedUrl,
    description: truncateDescription(raw.descriptionPlain ?? ""),
    postedAt: postedIso,
  });
}

/** Kept identical in spirit to the Greenhouse one: "acme-systems" -> "Acme Systems". */
function displayCompanyLever(slug: string): string {
  return slug
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fetchPostingsFor(slug: string): Promise<Job[]> {
  return fetchJson(
    `https://api.lever.co/v0/postings/${slug}?mode=json`,
    LeverResponseSchema,
  ).then((data) => {
    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of data) {
      try {
        jobs.push(normalizeLeverJob(raw, slug));
      } catch {
        skipped++; // one bad listing must not take the board down
      }
    }
    console.log(`source=${SOURCE} company=${slug} in=${data.length} out=${jobs.length} skipped=${skipped}`);
    return jobs;
  });
}

export async function fetchLever(slugs: readonly string[]): Promise<Job[]> {
  const results = await Promise.allSettled(slugs.map(fetchPostingsFor));

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
