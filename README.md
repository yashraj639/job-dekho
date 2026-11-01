# JobDekho

A small daily job finder for India-based or remote AI and full-stack engineering internships and full-time roles. It checks company career pages first, uses a few public job sources as backup, and sends matching listings to Telegram.

It finds jobs. It does not apply for you.

Licensed under the MIT License; see [LICENSE](LICENSE).

## Run it

```bash
brew install bun
bun install
bun run src/index.ts --dry-run
```

The daily GitHub Actions run needs two repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

For a real local run, set those same environment variables and run `bun run src/index.ts`.

## What it checks

- Direct company boards: Greenhouse, Lever and Ashby. Add company slugs in `config/companies.json`.
- Backup sources: Remotive, RemoteOK and Hacker News Who Is Hiring.
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
