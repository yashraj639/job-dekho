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

/**
 * Cheap rules that run before the LLM. Pure: no network, no files, no clock.
 * Returns the survivors, best keyword coverage first, capped at
 * `filters.maxJobsToScore`.
 */
export function prefilter(jobs: readonly Job[], filters: Filters, now: Date): Job[] {
  const cutoffMs = now.getTime() - filters.maxAgeDays * MS_PER_DAY;
  const scored: { job: Job; hits: number }[] = [];

  for (const job of jobs) {
    const text = `${job.title}\n${job.description}`;

    const roleHits = countMatches(text, filters.roleKeywords);
    if (roleHits === 0) continue;

    const stackHits = countMatches(text, filters.stackKeywords);
    if (stackHits === 0) continue;

    if (countMatches(job.title, filters.rejectTitleKeywords) > 0) continue;
    if (requiresTooManyYears(job.description, filters.rejectYearsOfExperience)) continue;
    if (!isLocationAcceptable(job, filters.allowedLocations)) continue;
    if (!isFresh(job.postedAt, cutoffMs)) continue;

    scored.push({ job, hits: roleHits + stackHits });
  }

  // Array#sort is stable, so equal-hit jobs keep their source order.
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, filters.maxJobsToScore).map((entry) => entry.job);
}
