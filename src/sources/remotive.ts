import { z } from "zod";
import { fetchJson, USER_AGENT } from "../http";
import { errorMessage } from "../log";
import { stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

const SOURCE = "remotive";
const ENDPOINT = "https://remotive.com/api/remote-jobs?category=software-dev";

const RemotiveJobSchema = z.object({
  id: z.number(),
  // Deliberately loose: the URL is validated per job so one bad listing
  // cannot fail the whole response.
  url: z.string(),
  title: z.string(),
  company_name: z.string(),
  candidate_required_location: z.string().default(""),
  publication_date: z.string().nullish(),
  description: z.string().default(""),
});
export type RemotiveJob = z.infer<typeof RemotiveJobSchema>;

const RemotiveResponseSchema = z.object({ jobs: z.array(RemotiveJobSchema) });

export function normalizeRemotiveJob(raw: RemotiveJob): Job {
  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.title.trim(),
    company: raw.company_name.trim(),
    location: raw.candidate_required_location.trim(),
    remote: true, // Remotive only lists remote roles
    url: raw.url,
    description: truncateDescription(stripHtml(raw.description)),
    postedAt: raw.publication_date ?? null,
  });
}

export async function fetchRemotive(): Promise<Job[]> {
  try {
    const data = await fetchJson(ENDPOINT, RemotiveResponseSchema, {
      headers: { "User-Agent": USER_AGENT },
    });

    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of data.jobs) {
      try {
        jobs.push(normalizeRemotiveJob(raw));
      } catch {
        skipped++; // one bad listing must not take the whole source down
      }
    }

    console.log(`source=${SOURCE} in=${data.jobs.length} out=${jobs.length} skipped=${skipped}`);
    return jobs;
  } catch (error) {
    console.error(`source=${SOURCE} error=${errorMessage(error)}`);
    return [];
  }
}
