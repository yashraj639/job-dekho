import { ZodError } from "zod";

/** One-line, log-safe description of anything thrown. Zod errors get flattened. */
export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return issues.replace(/\s+/g, " ");
  }
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
}
