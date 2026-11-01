import { z } from "zod";
import { fetchJson, USER_AGENT } from "../http";
import { errorMessage } from "../log";
import { buildGeminiPrompt, normalizeGeminiJobs } from "./gemini";
import type { Job } from "../types";

const SOURCE = "groq";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const ResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

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
        messages: [{ role: "user", content: buildGeminiPrompt(now) }],
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
