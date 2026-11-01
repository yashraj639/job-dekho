# JobDekho

A small daily job finder for India-based or India-eligible remote AI and full-stack engineering internships and full-time roles. It uses Gemini web search for discovery, checks company career pages and public sources as fallback, and sends matching listings to Telegram.

It finds jobs. It does not apply for you.

Licensed under the MIT License; see [LICENSE](LICENSE).

## Run it

```bash
brew install bun
bun install
bun run src/index.ts --dry-run
```

The daily GitHub Actions run needs three repository secrets:

- `GEMINI_API_KEY` (or the existing `GOOGLE_GENERATIVE_AI_API_KEY` secret)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

For a real local run, set those same environment variables and run `bun run src/index.ts`.

## What it checks

- Primary discovery: Gemini uses Google Search grounding to find fresh jobs and direct application links.
- Direct company boards: Greenhouse, Lever and Ashby. Add company slugs in `config/companies.json`.
- Trial fallback sources: Remotive, RemoteOK and Hacker News Who Is Hiring. They stay enabled for the first week so results can be compared.
- `config/filters.json` controls role, technology, location, seniority and freshness matches. Direct company board listings are shown first.
- A second **Resume match** alert catches additional jobs that overlap with the skills in `resumeKeywords`. Jobs already in the simple alerts are not repeated.

Alerts are kept short:

```text
Full-Stack AI Intern
Example Co · Remote
https://company.com/careers/job
```

The resume PDF stays out of the repo; only skill keywords are used. The pipeline remembers sent listings in `data/state.json`, retries failed Telegram messages on the next run, and never writes state during `--dry-run`. It does not scrape LinkedIn or Indeed.

## Checks

```bash
bun test
bunx tsc --noEmit
bun run src/index.ts --dry-run
```
