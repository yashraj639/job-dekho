# job-dekho

yo. this bot fetches dev jobs from the internet every single day so u don't have to refresh 15 tabs like a gremlin.

it pulls listings from six spots (remotive, remoteok, the hn who-is-hiring thread, plus greenhouse, lever and ashby company boards), kills the dupes, checks ur location/keywords, then has gemini read ur resume and score every job. anything that hits the threshold gets pinged to u on telegram.

it does not auto apply. u apply yourself. the bot just does the soul-crushing scroll part.

## run it

```
brew install bun (mac) | curl -fsSL bun.sh/install | bash (linux)
bun install

bun run src/index.ts --dry-run   # full run, but stays quiet (no msgs, no state writes)
bun run src/index.ts             # the real thing
bun test                         # tests, all offline
bunx tsc --noEmit                # typecheck
```

## what matters

- `config/filters.json` — ur keywords, locations, and how many jobs the LLM gets to see. edit this to change the hunt.
- `config/companies.json` — which company boards to scrape, per platform.
- `config/resume.md` — ur resume as markdown. the LLM reads this to score jobs. this repo stays private bc of this file fr.
- `data/state.json` — remembers every job it already showed u. no double-pings.

## prod

github actions runs the whole pipeline once a day and commits state back. it needs these secrets:

```
GOOGLE_GENERATIVE_AI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
LLM_MODEL   (optional, defaults to a specific gemini model)
```

## pls do not

- add auto-apply. it should never send applications.
- commit ur keys or ur resume. keys live in env vars, resume stays local/private.
- the job listings are untrusted text. they only ever get read, never executed.
