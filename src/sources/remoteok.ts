import { z } from "zod";
import { fetchJson, USER_AGENT } from "../http";
import { errorMessage } from "../log";
import { stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

const SOURCE = "remoteok";
const ENDPOINT = "https://remoteok.com/api";

const RemoteOkJobSchema = z.object({
  // Coerced: the API has sent both numbers and numeric strings.
  id: z.coerce.string(),
  url: z.string(),
  position: z.string(),
  company: z.string(),
  location: z.string().default(""),
  date: z.string().nullish(),
  description: z.string().nullish().default(""),
});
export type RemoteOkJob = z.infer<typeof RemoteOkJobSchema>;

// The response is an array; the first element is a legal notice, not a job.
// It must pass the array schema, otherwise one element would kill the source.
const LegalNoticeSchema = z.object({ legal: z.string() });
const RemoteOkResponseSchema = z.array(z.union([RemoteOkJobSchema, LegalNoticeSchema]));
export type RemoteOkJobInput = z.input<typeof RemoteOkJobSchema>;

export function normalizeRemoteOkJob(raw: RemoteOkJob): Job {
  return JobSchema.parse({
    id: `${SOURCE}:${raw.id}`,
    source: SOURCE,
    title: raw.position.trim(),
    company: raw.company.trim(),
    location: raw.location.trim(),
    remote: true, // RemoteOK only lists remote roles
    url: raw.url,
    description: truncateDescription(stripHtml(raw.description ?? "")),
    postedAt: raw.date ?? null,
  });
}

export async function fetchRemoteOk(): Promise<Job[]> {
  try {
    const data = await fetchJson(ENDPOINT, RemoteOkResponseSchema, {
      // RemoteOK blocks default client User-Agents: a proper one is required.
      headers: { "User-Agent": USER_AGENT },
    });

    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of data) {
      if ("legal" in raw) {
        skipped++; // the legal-notice element, not a job
        continue;
      }
      try {
        jobs.push(normalizeRemoteOkJob(raw));
      } catch {
        skipped++; // one bad listing must not take the source down
      }
    }

    console.log(`source=${SOURCE} in=${data.length} out=${jobs.length} skipped=${skipped}`);
    return jobs;
  } catch (error) {
    console.error(`source=${SOURCE} error=${errorMessage(error)}`);
    return [];
  }
}
