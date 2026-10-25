import { z } from "zod";
import { errorMessage } from "./log";

export const FiltersSchema = z.object({
  roleKeywords: z.array(z.string().min(1)).min(1),
  stackKeywords: z.array(z.string().min(1)).min(1),
  rejectTitleKeywords: z.array(z.string().min(1)),
  /** Reject when the posting asks for this many years of experience or more. */
  rejectYearsOfExperience: z.number().int().positive(),
  allowedLocations: z.array(z.string().min(1)).min(1),
  maxAgeDays: z.number().int().positive(),
  /** Hard ceiling on how many jobs reach the LLM. */
  maxJobsToScore: z.number().int().positive(),
  /** Scores at or above this are sent to Telegram. */
  notifyThreshold: z.number().min(0).max(10),
});
export type Filters = z.infer<typeof FiltersSchema>;

export async function loadFilters(path: string): Promise<Filters> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing config file ${path}`);

  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error(`config file ${path} is not valid JSON`);
  }

  const parsed = FiltersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`config file ${path} is invalid: ${errorMessage(parsed.error)}`);
  }
  return parsed.data;
}

/** Per-company job boards: which company slugs each board API should fetch. */
export const CompaniesSchema = z.object({
  greenhouse: z.array(z.string().min(1)),
  lever: z.array(z.string().min(1)),
  ashby: z.array(z.string().min(1)),
});
export type Companies = z.infer<typeof CompaniesSchema>;

export async function loadCompanies(path: string): Promise<Companies> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing config file ${path}`);

  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error(`config file ${path} is not valid JSON`);
  }

  const parsed = CompaniesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`config file ${path} is invalid: ${errorMessage(parsed.error)}`);
  }
  return parsed.data;
}

/** The resume is personal data: callers must never log the result. */
export async function loadResume(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing resume file ${path}`);

  const text = (await file.text()).trim();
  if (!text) throw new Error(`resume file ${path} is empty`);
  return text;
}
