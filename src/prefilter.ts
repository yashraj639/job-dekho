import type { Filters } from "./config";
import type { Job } from "./types";

const MS_PER_DAY = 86_400_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a configured keyword as whole words, treating spaces and hyphens as
 * interchangeable. "full stack" therefore also matches "full-stack", and
 * "intern" will not match "internal".
 */
function keywordPattern(keyword: string): RegExp {
  const parts = keyword
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp);
  return new RegExp(`\\b${parts.join("[\\s-]+")}\\b`, "i");
}

function countMatches(text: string, keywords: readonly string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (keywordPattern(keyword).test(text)) hits++;
  }
  return hits;
}

/** True when the posting asks for `threshold` years or more ("4-6 years" counts as 4). */
function requiresTooManyYears(description: string, threshold: number): boolean {
  const years = /\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/gi;

  for (const match of description.matchAll(years)) {
    const low = Number(match[1]);
    const high = match[2] === undefined ? low : Number(match[2]);
    if (Math.min(low, high) >= threshold) return true;
  }
  return false;
}

/** Unknown or unparseable dates are kept: bad data should not hide a job. */
function isFresh(postedAt: string | null, cutoffMs: number): boolean {
  if (!postedAt) return true;
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return true;
  return posted >= cutoffMs;
}

function isLocationAcceptable(job: Job, allowedLocations: readonly string[]): boolean {
  if (job.remote === true) return true;
  if (!job.location) return false;
  return countMatches(job.location, allowedLocations) > 0;
}

const DIRECT_SOURCES = new Set(["greenhouse", "lever", "ashby"]);

function filterByKeywords(
  jobs: readonly Job[],
  filters: Filters,
  keywords: readonly string[],
  now: Date,
): Job[] {
  const cutoffMs = now.getTime() - filters.maxAgeDays * MS_PER_DAY;
  const ranked: { job: Job; hits: number }[] = [];

  for (const job of jobs) {
    const text = `${job.title}\n${job.description}`;

    const roleHits = countMatches(text, filters.roleKeywords);
    if (roleHits === 0) continue;

    const stackHits = countMatches(text, keywords);
    if (stackHits === 0) continue;

    if (countMatches(job.title, filters.rejectTitleKeywords) > 0) continue;
    if (requiresTooManyYears(job.description, filters.rejectYearsOfExperience)) continue;
    if (!isLocationAcceptable(job, filters.allowedLocations)) continue;
    if (!isFresh(job.postedAt, cutoffMs)) continue;

    ranked.push({ job, hits: roleHits + stackHits });
  }

  // Stable sort keeps each source's configured company order when hits tie.
  ranked.sort(
    (a, b) =>
      Number(!DIRECT_SOURCES.has(a.job.source)) - Number(!DIRECT_SOURCES.has(b.job.source)) ||
      b.hits - a.hits,
  );
  return ranked.map((entry) => entry.job);
}

/** General job finder. Direct company career boards come before aggregators. */
export function prefilter(jobs: readonly Job[], filters: Filters, now: Date): Job[] {
  return filterByKeywords(jobs, filters, filters.stackKeywords, now);
}

/** Resume-specific skills use the same role, location, seniority and freshness rules. */
export function prefilterResume(jobs: readonly Job[], filters: Filters, now: Date): Job[] {
  return filterByKeywords(jobs, filters, filters.resumeKeywords, now);
}
