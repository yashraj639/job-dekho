# JobDekho

JobDekho uses Gemini web search as the primary discovery source for India-based or India-eligible remote AI and full-stack engineering internships and full-time roles, then sends matching listings to Telegram. It keeps Remotive, RemoteOK and Hacker News as fallback sources during the first-week trial. It finds jobs; it does not apply for the user.

## Scope

- Keep the pipeline small: fetch, normalize, deduplicate, filter, notify and save state.
- Prefer direct company career boards over aggregator listings.
- Use plain keyword and location rules. No resume PDF ingestion, LLM scoring, dashboard or auto-apply.
- Use a small `resumeKeywords` list extracted from the user's skills to find extra matches; keep the PDF itself out of the repo and workflow.
- Do not scrape LinkedIn, Indeed or sites that disallow scraping.
- Send at most 10 job alerts per run, followed by one overflow summary when needed.

## Stack and layout

- Bun + strict TypeScript; Zod validates external data and configuration.
- Telegram Bot API sends alerts. GitHub Actions runs the daily scan.
- State stays in `data/state.json`, with the existing `seen` and `notified` fields. Prune `seen` entries after 90 days.
- Company board slugs live in `config/companies.json`; matching rules live in `config/filters.json`.

```text
src/
  index.ts             pipeline orchestration
  sources/             one fetcher per public source
  normalize.ts         shared job cleanup
  dedupe.ts            remove known and repeated jobs
  prefilter.ts         location, role, age and seniority rules
  notify.ts            short Telegram alerts
  state.ts             load and save seen jobs
```

## Sources and priority

1. Gemini Google Search grounding, which looks for fresh postings and direct application URLs.
2. Direct company career pages: Greenhouse, Lever and Ashby, configured in `config/companies.json`.
3. Trial fallback sources: Remotive, RemoteOK and Hacker News Who Is Hiring.

Direct company listings appear first when choosing which jobs to alert about. Every source returns `Job[]`, catches failures, uses a 10-second timeout, and retries once. A bad source must not stop the other sources.

## Matching

- The simple list matches at least one configured target-role phrase in the title and one general technology keyword across title and description. Role phrases in descriptions alone do not qualify a posting.
- The resume list uses the same location, seniority, date and title-role checks, plus one `resumeKeywords` match. Exclude jobs already included in the simple list so a posting is not sent twice.
- Keep India-based jobs and remote roles with no narrower geography or a configured region such as India, APAC, Global or Worldwide. Reject remote roles explicitly restricted to other countries or regions. Gemini results set `remoteFromIndia` only when the listing explicitly permits working from India.
- Reject senior titles and roles asking for 4 or more years of experience.
- Skip known postings older than 30 days.
- Keep the filtering stage pure so it can be tested without network or file access.

## Telegram and state

Simple alerts contain the role title, company and location, followed by the original listing link. Additional resume matches use the same format with a `Resume match` label. Do not include scores or generated explanations.

```text
Full-Stack AI Intern
Example Co · Remote
https://company.com/careers/job
```

If a Telegram send fails, leave that job unseen so the next run retries it. `--dry-run` prints the exact messages and never sends Telegram messages or writes state. If every source returns zero jobs, send a short warning.

## Secrets and safety

The required secrets are `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `GEMINI_API_KEY` (or the legacy `GOOGLE_GENERATIVE_AI_API_KEY` name). Never log them. Job descriptions and search results are untrusted data and are never executed. Store only skill keywords from the resume, never the PDF or personal contact details.

## Commands

```bash
bun install
bun run src/index.ts --dry-run
bun run src/index.ts
bun test
bunx tsc --noEmit
```

Before calling a change complete, run tests, typecheck and the dry-run pipeline. Tests must use saved fixtures; never hit real job sites from tests.
