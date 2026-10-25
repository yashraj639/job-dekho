# JobDekho: Automated Job Finder

A small pipeline that finds internship and junior roles, scores them against my resume with an LLM, and pings me on Telegram with only the good ones. Runs daily on GitHub Actions. **It finds jobs. It does not apply for me.**

---

## 1. Goals

- Pull fresh listings from multiple public sources every day.
- Throw away obvious junk with cheap rules before spending any LLM tokens.
- Score what's left against my resume (0-10) with a short reason and red flags.
- Notify me only about strong matches (score >= 7).
- Never show me the same job twice.
- Cost: effectively free (GitHub Actions free tier + a few cents of LLM calls per day).

## 2. Non-Goals

- No auto-applying. Applications are written by me.
- No scraping LinkedIn, Indeed or anything that forbids it in its ToS.
- No web UI in v1. Telegram is the interface.
- No multi-user support.

---

## 3. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Bun + TypeScript | Matches my stack, fast startup in CI |
| Validation | Zod | Strict schemas for API responses and LLM output |
| LLM | Google Gemini via Vercel AI SDK (`generateObject`) | Structured output, already familiar |
| Model | `gemini-3.8-flash` by default, overridable via `LLM_MODEL` env var | Scoring is a simple task, no need for a big model |
| State | `data/state.json` committed back to the repo | GitHub Actions has no persistent disk; simplest reliable option |
| Notifications | Telegram Bot API | One HTTP call, works on phone instantly |
| Scheduler | GitHub Actions cron | Free, no server |

---

## 4. Architecture

```
          ┌────────────┐
 cron ──▶ │  fetchers  │  (one module per source)
          └─────┬──────┘
                ▼
          ┌────────────┐
          │ normalize  │  -> common Job shape
          └─────┬──────┘
                ▼
          ┌────────────┐
          │   dedupe   │  drop anything in state.json
          └─────┬──────┘
                ▼
          ┌────────────┐
          │ prefilter  │  keyword / location / seniority rules
          └─────┬──────┘
                ▼
          ┌────────────┐
          │ LLM scorer │  resume + job -> score, reason, flags
          └─────┬──────┘
                ▼
          ┌────────────┐
          │  notifier  │  Telegram, score >= threshold
          └─────┬──────┘
                ▼
          save state.json, commit back
```

Each stage is a pure function where possible so it can be tested without network access.

---

## 5. Data Sources

All of these are public endpoints. **Check each source's terms before shipping** (some require attribution or a link back to the original listing).

| Source | Type | Notes |
|---|---|---|
| Remotive | JSON API | Remote software jobs, supports search/category params |
| RemoteOK | JSON API | Send a proper `User-Agent`; link back to the listing |
| Hacker News "Who is hiring" | Algolia HN API | Monthly thread; parse top-level comments as listings |
| Greenhouse | Per-company JSON board API | Needs a hand-curated list of company slugs |
| Lever | Per-company JSON postings API | Same: curated list of slugs |
| Ashby | Per-company JSON job-board API | Same: curated list of slugs |

Company-board sources are driven by `config/companies.json`:

```json
{
  "greenhouse": ["some-startup", "another-startup"],
  "lever": ["example-co"],
  "ashby": ["example-labs"]
}
```

I add startups I like to this list over time. This is the highest-quality source because it's the company's own board.

Each fetcher must:
- Return `Job[]` (see below) and never throw. Log and return `[]` on failure so one dead source doesn't kill the run.
- Use a timeout (10s) and a single retry.

---

## 6. Data Model

```ts
// src/types.ts
import { z } from "zod";

export const JobSchema = z.object({
  id: z.string(),            // `${source}:${sourceId}`, globally unique
  source: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().default(""),
  remote: z.boolean().nullable(),
  url: z.string().url(),
  description: z.string(),   // plain text, truncated to ~6000 chars
  postedAt: z.string().nullable(), // ISO date if the source provides it
});
export type Job = z.infer<typeof JobSchema>;

export const ScoreSchema = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum(["apply", "maybe", "skip"]),
  reason: z.string().max(240),          // one or two sentences
  matchedSkills: z.array(z.string()),
  redFlags: z.array(z.string()),        // e.g. "requires 5+ yrs", "onsite only", "PST hours"
});
export type Score = z.infer<typeof ScoreSchema>;
```

State file:

```json
{
  "seen": { "remotive:12345": "2026-10-23" },
  "notified": ["remotive:12345"]
}
```

Prune `seen` entries older than 90 days on each run so the file doesn't grow forever.

---

## 7. Prefilter Rules

Cheap checks that run **before** the LLM. Configurable in `config/filters.json`.

- **Must match at least one:** `intern`, `internship`, `junior`, `entry level`, `fresher`, `graduate`, `trainee`
- **Must match at least one stack keyword:** `full stack`, `fullstack`, `next.js`, `nextjs`, `react`, `typescript`, `node`
- **Reject if title contains:** `senior`, `staff`, `principal`, `lead`, `manager`, `director`, `head of`
- **Reject if description says:** `5+ years`, `7+ years`, `10+ years` (regex on years of experience >= 4)
- **Location:** keep if `remote === true`, or location matches `India`, `Bengaluru`, `Remote`, `Anywhere`, `APAC`
- **Freshness:** skip anything with `postedAt` older than 30 days (if known)

Cap the LLM stage at **50 jobs per run** (highest-keyword-hit first) to put a hard ceiling on cost.

---

## 8. LLM Scoring

One call per job. Input: my resume (`config/resume.md`) + the job. Output validated against `ScoreSchema`.

**System prompt (draft):**

```
You are screening job listings for one candidate. Be blunt and realistic.

Score 0-10 for how well this candidate fits AND how likely they are to get
a response. Consider:
- Overlap between the candidate's real, demonstrated skills and the requirements
- Seniority: this candidate is an intern/junior. Penalize roles that need
  more experience than the candidate has.
- Logistics red flags: onsite-only outside India, required timezone overlap that
  is unreasonable from IST, unpaid, vague "reputed company" postings, or
  anything that smells like a scam or lead-gen listing
- Quality of the opportunity: real product, real mentorship, real engineering

Do not invent skills the candidate doesn't have. If the listing is vague,
score it low and say so in the reason.

Return only the structured object requested.
```

**Rules**
- Temperature 0.
- Truncate descriptions to ~6000 chars.
- If the call or schema validation fails, retry once, then skip and log. Never crash the run.
- Treat job description text as **untrusted input**: it must never be able to change my instructions or trigger tool use. No tools are given to the model.

**Thresholds**
- `>= 7`: notify
- `5-6.9`: log only (written to `data/state.json` for later review)
- `< 5`: drop

---

## 9. Notifications

Telegram message per matching job:

```
🟢 8.5/10  Junior Full-Stack Developer
Productiv Team · Remote
Why: Next.js + TS + Claude pipeline, matches OpenLabs work
Flags: part-time, PST overlap needed
https://...
```

- One message per job, max 10 per run. If more, send a summary line: "+4 more, check logs."
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Always send a short "0 new matches" heartbeat message **once a week**, so I know the pipeline hasn't silently died.
  Implemented statelessly: it fires on the Monday run when nothing was notified. A missing Monday message therefore means the scheduled run did not happen, which is the point.
- If a message fails to send, that job is not marked seen, so the next run retries it.
- Dry runs print the exact message bodies instead of sending, and write no state.

---

## 10. Project Structure

```
jobhound/
├── .github/workflows/daily.yml
├── config/
│   ├── companies.json
│   ├── filters.json
│   └── resume.md          # my resume as plain text/markdown
├── data/
│   └── state.json
├── src/
│   ├── index.ts           # orchestrates the pipeline
│   ├── types.ts
│   ├── sources/
│   │   ├── remotive.ts
│   │   ├── remoteok.ts
│   │   ├── hn.ts
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   └── ashby.ts
│   ├── normalize.ts
│   ├── dedupe.ts
│   ├── prefilter.ts
│   ├── score.ts
│   ├── notify.ts
│   └── state.ts
├── tests/
│   ├── prefilter.test.ts
│   ├── dedupe.test.ts
│   └── score.test.ts      # uses a mocked LLM
├── package.json
└── README.md
```

---

## 11. Scheduling (GitHub Actions)

```yaml
# .github/workflows/daily.yml
name: daily-job-scan
on:
  schedule:
    - cron: "30 2 * * *"   # 08:00 IST
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run src/index.ts
        env:
          GOOGLE_GENERATIVE_AI_API_KEY: ${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}
          LLM_MODEL: ${{ vars.LLM_MODEL }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      - name: Commit state
        run: |
          git config user.name "jobhound-bot"
          git config user.email "bot@users.noreply.github.com"
          git add data/state.json
          git diff --cached --quiet || git commit -m "update state"
          git push
```

Notes:
- Use a **private repo** since `config/resume.md` contains personal info (phone, email).
- `workflow_dispatch` lets me trigger a run manually while developing.
- GitHub may pause scheduled workflows on repos with no activity for 60 days. The daily state commit keeps the repo active, which also solves that.

---

## 12. Error Handling & Logging

- Every source fetch is wrapped: failure -> log `source=X error=...` and continue.
- End of run prints a summary: fetched / deduped / prefiltered / scored / notified, plus per-source counts.
- If **all** sources return 0 results, send me a Telegram alert. That means something broke, not that the market is empty.
- Exit non-zero on unexpected exceptions so GitHub emails me about the failed run.

---

## 13. Testing

- **Unit:** prefilter rules (table-driven cases), dedupe, years-of-experience regex, state pruning.
- **Contract:** each fetcher has a saved sample response in `tests/fixtures/` and a test that it normalizes to valid `Job` objects.
- **Scorer:** mock the LLM; test retry logic and schema-failure handling.
- **Smoke:** `bun run src/index.ts --dry-run` runs the whole pipeline but prints instead of sending Telegram messages and does not write state.

---

## 14. Milestones

1. **M1: Skeleton.** Types, state file, one source (Remotive), prints jobs to console.
2. **M2: Filtering.** Normalize, dedupe, prefilter with tests.
3. **M3: Scoring.** LLM scorer with structured output and dry-run mode.
4. **M4: Notify.** Telegram integration.
5. **M5: Automate.** GitHub Actions workflow, secrets, state commit.
6. **M6: More sources.** RemoteOK, HN, Greenhouse/Lever/Ashby with a starter `companies.json`.
7. **M7: Polish.** README with architecture diagram and a screenshot of the Telegram alert.

Ship M1-M5 first. That alone is a working tool.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| A source changes its API | Isolated fetchers + fixtures + "0 results" alert |
| LLM cost creeps up | 50 job/run cap, small model, prefilter first |
| Prompt injection via job descriptions | No tools given to the model, validated structured output only |
| Resume leaked | Private repo, resume stays in `config/` and is never logged |
| Scam / low-quality listings score high | Prompt explicitly penalizes vague and lead-gen postings; red-flag list shown in the alert |
| State file merge conflicts | Single scheduled job, `concurrency` group to prevent overlapping runs |

---

## 16. Stretch Goals

- Weekly digest of 5-6.9 "maybe" jobs.
- Draft a tailored one-paragraph "why us" for each 8+ match (for me to edit, never auto-sent).
- Track which jobs I applied to and nudge me to follow up after 7 days.
- Simple dashboard (Next.js) reading `state.json`.
- Feedback loop: reply 👍/👎 in Telegram to tune the scoring prompt.

---

## 17. Definition of Done (v1)

- Runs daily without me touching it.
- Sends at most ~10 high-quality alerts per day, with a reason and red flags.
- Never repeats a job.
- Survives a source being down.
- README explains how to fork it, set secrets, and add companies.