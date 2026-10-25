import { loadCompanies, loadFilters, loadResume } from "./config";
import { dedupe } from "./dedupe";
import { errorMessage } from "./log";
import {
  createTelegramPost,
  formatHeartbeat,
  formatNoResults,
  planMessages,
  sendMessages,
  shouldSendHeartbeat,
  type Match,
  type PlannedMessage,
  type PostMessage,
} from "./notify";
import { prefilter } from "./prefilter";
import { DEFAULT_MODEL, createGeminiGenerate, scoreJob } from "./score";
import { fetchAshby } from "./sources/ashby";
import { fetchGreenhouse } from "./sources/greenhouse";
import { fetchHn } from "./sources/hn";
import { fetchLever } from "./sources/lever";
import { fetchRemotive } from "./sources/remotive";
import { fetchRemoteOk } from "./sources/remoteok";
import { loadState, markNotified, markSeen, pruneState, saveState } from "./state";
import type { Job, Score } from "./types";

const STATE_PATH = "data/state.json";
const FILTERS_PATH = "config/filters.json";
const COMPANIES_PATH = "config/companies.json";
const RESUME_PATH = "config/resume.md";

function printScore(job: Job, score: Score): void {
  console.log(`${score.score.toFixed(1)}/10 ${score.verdict}  ${job.title} @ ${job.company}`);
  console.log(`   why: ${score.reason}`);
  if (score.redFlags.length > 0) console.log(`   flags: ${score.redFlags.join(", ")}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  const state = await loadState(STATE_PATH);
  const filters = await loadFilters(FILTERS_PATH);
  const resume = await loadResume(RESUME_PATH);
  console.log(
    `stage=state seen=${Object.keys(state.seen).length} notified=${state.notified.length} dryRun=${dryRun}`,
  );

  // Built lazily so a dry run never needs Telegram credentials.
  let post: PostMessage | null = null;

  /** Returns the ids whose message failed to send, so they can be retried tomorrow. */
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
    return result.failedJobIds;
  };

  const companies = await loadCompanies(COMPANIES_PATH);
  console.log(
    `stage=config boards greenhouse=${companies.greenhouse.length} lever=${companies.lever.length} ashby=${companies.ashby.length}`,
  );

  // All six sources fetch independently; a dead source returns [] from inside.
  const perSource = await Promise.all([
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
    console.log("stage=summary fetched=0 deduped=0 prefiltered=0 scored=0 matches=0 sources=6");
    return;
  }

  const deduped = dedupe(fetched, state);
  console.log(`stage=dedupe in=${fetched.length} out=${deduped.length}`);

  const kept = prefilter(deduped, filters, now);
  console.log(`stage=prefilter in=${deduped.length} out=${kept.length}`);

  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const generate = createGeminiGenerate(modelId);
  console.log(`stage=score model=${modelId} in=${kept.length}`);

  const scored: Match[] = [];
  for (const job of kept) {
    const score = await scoreJob(job, resume, generate);
    if (score) scored.push({ job, score });
  }
  console.log(`stage=score out=${scored.length} skipped=${kept.length - scored.length}`);

  for (const { job, score } of scored) printScore(job, score);

  const matches = scored.filter(({ score }) => score.score >= filters.notifyThreshold);
  const failedIds = new Set(await send(planMessages(matches)));

  if (shouldSendHeartbeat(now) && matches.length === 0) {
    await send([{ text: formatHeartbeat(fetched.length, scored.length), jobId: null }]);
  }

  // Only jobs we scored are marked seen. A job whose alert failed to send stays
  // unseen so tomorrow's run tries again.
  if (dryRun) {
    console.log("stage=state skipped dry-run (no writes)");
  } else {
    let next = state;
    for (const { job } of scored) {
      if (!failedIds.has(job.id)) next = markSeen(next, job.id, now);
    }
    for (const { job } of matches) {
      if (!failedIds.has(job.id)) next = markNotified(next, job.id);
    }
    next = pruneState(next, now);
    await saveState(STATE_PATH, next);
    console.log(
      `stage=state saved seen=${Object.keys(next.seen).length} notified=${next.notified.length}`,
    );
  }

  console.log(
    `stage=summary fetched=${fetched.length} deduped=${deduped.length} prefiltered=${kept.length} scored=${scored.length} matches=${matches.length} sources=6`,
  );
}

main().catch((error: unknown) => {
  console.error(`fatal error=${errorMessage(error)}`);
  process.exit(1);
});
