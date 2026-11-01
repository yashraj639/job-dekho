# JobDekho

A small daily job finder for India-based or India-eligible remote AI and full-stack engineering internships and full-time roles. It uses Groq browser search for discovery, checks company career pages and public sources as fallback, and sends matching listings to Telegram.

It finds jobs. It does not apply for you.

Licensed under the MIT License; see [LICENSE](LICENSE).

## Run it

```bash
brew install bun
bun install
bun run src/index.ts --dry-run
```

The daily GitHub Actions run needs three repository secrets:

- `GROQ_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

For a real local run, set those same environment variables and run `bun run src/index.ts`.

## What it checks

- Primary discovery: Groq browser search uses `openai/gpt-oss-120b` to find fresh jobs and direct application links.
- Direct company boards: Greenhouse, Lever and Ashby. Add company slugs in `config/companies.json`.
- The workflow currently uses the six direct/public feeds only. Groq discovery remains in the code but is paused with `DISCOVERY_ENABLED=false`; set it to `true` to try it again later.
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
