import type { z } from "zod";
import { fetchJson } from "../http";
import { errorMessage } from "../log";
import type { Job } from "../types";

/**
 * A per-company job board. Everything that differs between Lever, Ashby and
 * Greenhouse lives in this object; the fetching, skipping and logging are shared.
 */
export interface BoardSource<TResponse, TRaw> {
  /** Name used in log lines, e.g. "lever". */
  source: string;
  /** Full URL of one company's board. */
  url: (slug: string) => string;
  /** Validates the whole response body. */
  schema: z.ZodType<TResponse>;
  /** Picks the raw postings out of the response. */
  postings: (response: TResponse) => readonly TRaw[];
  /** One raw posting -> Job, or null to skip it. */
  normalize: (raw: TRaw, slug: string) => Job | null;
}

/**
 * Fetch every slug in parallel and never throw: a dead board is logged and
 * skipped, a bad posting is counted and skipped.
 */
export async function fetchBoards<TResponse, TRaw>(
  board: BoardSource<TResponse, TRaw>,
  slugs: readonly string[],
): Promise<Job[]> {
  const fetchBoard = async (slug: string): Promise<Job[]> => {
    const response = await fetchJson(board.url(slug), board.schema);
    const raws = board.postings(response);

    const jobs: Job[] = [];
    let skipped = 0;
    for (const raw of raws) {
      try {
        const job = board.normalize(raw, slug);
        if (job === null) throw new Error("posting skipped by normalizer");
        jobs.push(job);
      } catch {
        skipped++; // one bad listing must not take the board down
      }
    }

    console.log(
      `source=${board.source} company=${slug} in=${raws.length} out=${jobs.length} skipped=${skipped}`,
    );
    return jobs;
  };

  const results = await Promise.allSettled(slugs.map((slug) => fetchBoard(slug)));

  const jobs: Job[] = [];
  let failed = 0;
  results.forEach((result, index) => {
    const slug = slugs[index] ?? "(unknown)";
    if (result.status === "rejected") {
      failed++;
      console.error(`source=${board.source} company=${slug} error=${errorMessage(result.reason)}`);
    } else {
      jobs.push(...result.value);
    }
  });

  console.log(
    `source=${board.source} in=${slugs.length} companies out=${jobs.length} failed=${failed}`,
  );
  return jobs;
}
