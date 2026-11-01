import { z } from "zod";
import { fetchJson, USER_AGENT } from "../http";
import { errorMessage } from "../log";
import { normalizeGeminiJobs } from "./gemini";
import type { Job } from "../types";

const SOURCE = "groq";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const ResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

function buildGroqPrompt(now: Date): string {
  return `Search for at most 5 jobs posted in the last 24 hours as of ${now.toISOString()}. Find India-based or India-eligible remote internships, new-grad, junior or full-time AI, machine-learning, backend, frontend, full-stack or software-engineering roles matching JavaScript, TypeScript, React, Next.js or Node.js. Use only official company career/application pages; exclude LinkedIn, Indeed, Naukri, Glassdoor, aggregators, agencies, support, sales, analyst, HR and senior roles. Return ONLY a JSON array with title, company, location, remoteFromIndia, applicationUrl, postedAt and description (under 300 characters). Return [] if no valid direct links qualify.`;
}

function parseJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

export async function fetchGroq(now = new Date()): Promise<Job[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error(`source=${SOURCE} error=GROQ_API_KEY not set`);
    return [];
  }

  try {
    const response = await fetchJson(ENDPOINT, ResponseSchema, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: buildGroqPrompt(now) }],
        tools: [{ type: "browser_search" }],
      }),
    });
    const discovered = normalizeGeminiJobs(parseJson(response.choices[0]?.message.content ?? "[]"));
    const jobs = discovered.map((job): Job => ({ ...job, id: `${SOURCE}:${job.url}`, source: SOURCE }));
    console.log(`source=${SOURCE} out=${jobs.length}`);
    return jobs;
  } catch (error) {
    console.error(`source=${SOURCE} error=${errorMessage(error)}`);
    return [];
  }
}
