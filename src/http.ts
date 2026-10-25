import type { z } from "zod";

/** Sent on every request that needs one. Some APIs reject the default UA. */
export const USER_AGENT = "job-dekho/0.1 (personal job search bot)";

/** Every outbound request gets this long, and at most one retry. */
export const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2;

async function requestOnce(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

/** GET a JSON endpoint, validate it with `schema`, retry once on any failure. */
export async function fetchJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await requestOnce(url, init);
      return schema.parse(await response.json());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
