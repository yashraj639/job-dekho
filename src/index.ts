import { loadCompanies, loadFilters } from "./config";
import { dedupe } from "./dedupe";
import { errorMessage } from "./log";
import {
  createTelegramPost,
  formatNoResults,
  planMessages,
  sendMessages,
  type PlannedMessage,
  type PostMessage,
} from "./notify";
import { prefilter, prefilterResume } from "./prefilter";
import { fetchAshby } from "./sources/ashby";
import { fetchGreenhouse } from "./sources/greenhouse";
import { fetchGemini } from "./sources/gemini";
import { fetchHn } from "./sources/hn";
import { fetchLever } from "./sources/lever";
import { fetchRemotive } from "./sources/remotive";
import { fetchRemoteOk } from "./sources/remoteok";
import { loadState, markNotified, markSeen, pruneState, saveState } from "./state";

const STATE_PATH = "data/state.json";
const FILTERS_PATH = "config/filters.json";
const COMPANIES_PATH = "config/companies.json";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  const state = await loadState(STATE_PATH);
  const filters = await loadFilters(FILTERS_PATH);
  console.log(
    `stage=state seen=${Object.keys(state.seen).length} notified=${state.notified.length} dryRun=${dryRun}`,
  );

  // Built lazily so a dry run never needs Telegram credentials.
  let post: PostMessage | null = null;

  /** Return only delivered job ids; failed and overflow jobs stay available next run. */
  const send = async (plan: readonly PlannedMessage[]): Promise<string[]> => {
    if (plan.length === 0) return [];

    if (dryRun) {
      for (const message of plan) console.log(`[dry-run] ${message.text}`);
      console.log(`stage=notify skipped dry-run planned=${plan.length}`);
      return [];
    }

    post ??= createTelegramPost();
    const result = await sendMessages(plan, post);
    console.log(`stage=notify sent=${result.sent} failed=${result.failed}`);
    return result.sentJobIds;
  };

  const companies = await loadCompanies(COMPANIES_PATH);
  console.log(
    `stage=config boards greenhouse=${companies.greenhouse.length} lever=${companies.lever.length} ashby=${companies.ashby.length}`,
  );

  // All seven sources fetch independently; a dead source returns [] from inside.
  const perSource = await Promise.all([
    fetchGemini(now),
    fetchRemotive(),
    fetchRemoteOk(),
    fetchHn(),
    fetchGreenhouse(companies.greenhouse),
    fetchLever(companies.lever),
    fetchAshby(companies.ashby),
  ]);
  const fetched = perSource.flat();
  console.log(`stage=fetch sources=${perSource.length} out=${fetched.length}`);

  if (fetched.length === 0) {
    await send([{ text: formatNoResults(), jobId: null }]);
    console.log("stage=summary fetched=0 deduped=0 matched=0 notified=0 sources=7");
    return;
  }

  const deduped = dedupe(fetched, state);
  console.log(`stage=dedupe in=${fetched.length} out=${deduped.length}`);

  const matches = prefilter(deduped, filters, now);
  const generalIds = new Set(matches.map((job) => job.id));
  const resumeMatches = prefilterResume(deduped, filters, now).filter((job) => !generalIds.has(job.id));
  const resumeIds = new Set(resumeMatches.map((job) => job.id));
  const toNotify = [...matches, ...resumeMatches];
  console.log(`stage=match general=${matches.length} resumeExtra=${resumeMatches.length}`);
  const sentIds = new Set(await send(planMessages(toNotify, resumeIds)));

  if (dryRun) {
    console.log("stage=state skipped dry-run (no writes)");
  } else {
    let next = state;
    for (const job of toNotify) {
      if (sentIds.has(job.id)) {
        next = markSeen(next, job.id, now);
        next = markNotified(next, job.id);
      }
    }
    next = pruneState(next, now);
    await saveState(STATE_PATH, next);
    console.log(
      `stage=state saved seen=${Object.keys(next.seen).length} notified=${next.notified.length}`,
    );
  }

  console.log(
    `stage=summary fetched=${fetched.length} deduped=${deduped.length} general=${matches.length} resumeExtra=${resumeMatches.length} sources=7`,
  );
}

main().catch((error: unknown) => {
  console.error(`fatal error=${errorMessage(error)}`);
  process.exit(1);
});
