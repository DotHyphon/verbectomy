#!/usr/bin/env node
// Stop / SubagentStop hook: get the turn's changed comments reviewed. Async by
// default (spawn a detached worker, return in ~100ms, act on the previous
// verdict) so a one-line task is not held up by a model call; asyncReview:false
// blocks on the review instead. Only files changed since baseline; fails open.
import {
  isChild,
  loadConfig,
  loadRules,
  readInput,
  counterPath,
  readCounter,
  bumpCounter,
  clearCounter,
  statePath,
  readState,
  writeState,
  collectDiffPieces,
  docStylesForFiles,
  buildReviewPrompt,
  runReviewer,
  recentUserMessages,
  findingsPath,
  readFindings,
  clearFindings,
  findingsAreStale,
  waitForFindings,
  lockPath,
  workerRunning,
  queueReview,
  pieceMayHaveComments,
  formatViolations,
  violationInstruction,
  logRun,
} from "./lib.mjs";

const t0 = Date.now();
const exit = (code) => process.exit(code);
if (isChild()) exit(0);

const input = await readInput();
const cwd = input.cwd || process.cwd();
const sid = String(input.session_id || "nosession").slice(0, 8);
const log = (msg) => logRun(`stop  [${sid}] ${msg} (${Date.now() - t0}ms)`);
const cfg = loadConfig(cwd);

const maxAttempts = cfg.maxAttempts ?? 3;
const maxDiffChars = cfg.maxDiffChars ?? 0;
const async = cfg.asyncReview !== false;

const counter = counterPath("stop", input.session_id);
const stateFile = statePath(input.session_id);
const state = readState(stateFile);
const findingsFile = findingsPath(input.session_id);

const block = (violations) => {
  const reason =
    `${violationInstruction(violations.length)} Then stop. Stop again unchanged only if a ` +
    `violation is wrong or the user approved the comment.\n\n${formatViolations(violations)}`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  exit(0);
};

const pieces = collectDiffPieces(cwd, cfg);

// Act on a completed background review before starting another. Findings whose
// files the agent has since edited are stale: re-review the new text rather than
// block on comments that may already be gone.
if (async) {
  // A review the post-edit hook started may be seconds from done. Waiting for it
  // buys same-turn enforcement, so it is a knob rather than a fixed choice.
  const waitMs = cfg.stopWaitMs ?? 0;
  if (waitMs > 0 && !readFindings(findingsFile) && workerRunning(lockPath(input.session_id))) {
    const waited = waitForFindings(findingsFile, waitMs);
    log(waited ? `waited for in-flight review, verdict arrived` : `waited ${waitMs}ms, review still running`);
  }
  const findings = readFindings(findingsFile);
  if (findings && !findingsAreStale(findings, pieces)) {
    const attempts = readCounter(counter);
    if (attempts >= maxAttempts) {
      clearCounter(counter);
      clearFindings(findingsFile);
      process.stderr.write(`verbectomy: max attempts (${maxAttempts}) reached, allowing stop.\n`);
      log(`gave up: max attempts (${maxAttempts}) reached, violations may stand`);
      exit(0);
    }
    bumpCounter(counter, attempts + 1);
    clearFindings(findingsFile);
    log(`block: ${findings.violations.length} violation(s) from background review, attempt ${attempts + 1}/${maxAttempts}`);
    block(findings.violations);
  }
  if (findings) {
    clearFindings(findingsFile);
    log("stale findings dropped: flagged files changed since review");
  }
}

const userMsgs = recentUserMessages(input.transcript_path);

// Async: queue whatever the post-edit hook has not already had reviewed and get
// out of the way. The verdict is picked up by a later tool call or the next stop.
if (async) {
  const result = queueReview({ cwd, cfg, sessionId: input.session_id, userMsgs });
  clearCounter(counter);
  if (result.tooLarge) {
    const note = `automated comment review skipped: changes too large (${result.totalChars} chars, over the ${maxDiffChars} limit). Run /verbectomy-review ${result.files.join(" ")} to review these files`;
    process.stderr.write(`verbectomy: ${note}.\n`);
    log(`skip: ${note}`);
  } else if (result.queued) log(`queued: ${result.queued} file(s) to background reviewer pid ${result.pid}`);
  else if (result.error) log(`fail-open: worker spawn failed, ${result.error}`);
  else log(`skip: ${result.skip}`);
  exit(0);
}

const pending = pieces.filter((p) => state[p.file] !== p.hash);
if (pending.length === 0) {
  clearCounter(counter);
  log(`skip: ${pieces.length} changed file(s), none new since baseline/last pass`);
  exit(0);
}

// A diff with no comment syntax anywhere cannot hold a comment violation, so it
// is settled here instead of costing a model call.
for (const p of pending) if (!pieceMayHaveComments(p)) state[p.file] = p.hash;
const reviewable = pending.filter(pieceMayHaveComments);
if (reviewable.length === 0) {
  writeState(stateFile, state);
  clearCounter(counter);
  log(`skip: ${pending.length} changed file(s), no comment syntax in any diff`);
  exit(0);
}

// Over the size limit, skip auto-review: a partial review silently misses
// violations. Mark hashes so the notice fires once per version, not every stop.
const totalChars = reviewable.reduce((n, p) => n + p.text.length, 0);
if (maxDiffChars > 0 && totalChars > maxDiffChars) {
  for (const p of reviewable) state[p.file] = p.hash;
  writeState(stateFile, state);
  clearCounter(counter);
  const note = `automated comment review skipped: changes too large (${totalChars} chars, over the ${maxDiffChars} limit). Run /verbectomy-review ${reviewable.map((p) => p.file).join(" ")} to review these files`;
  process.stderr.write(`verbectomy: ${note}.\n`);
  log(`skip: ${note}`);
  exit(0);
}

// Synchronous path: cap retries BEFORE spending a model call, so a stubborn
// false positive can't trap the user.
const attempts = readCounter(counter);
if (attempts >= maxAttempts) {
  clearCounter(counter);
  process.stderr.write(`verbectomy: max attempts (${maxAttempts}) reached, allowing stop.\n`);
  log(`gave up: max attempts (${maxAttempts}) reached, violations may stand`);
  exit(0);
}

const diff = reviewable.map((p) => p.text).join("\n");
const styles = docStylesForFiles(reviewable.map((p) => p.file));
const prompt = buildReviewPrompt({
  rules: loadRules(cwd),
  diff,
  styles,
  requireDoc: cfg.requireDoc,
  userMsgs,
});

const result = runReviewer({ prompt, model: cfg.model, cwd });
if (!result.ok) {
  writeState(stateFile, state);
  process.stderr.write(`verbectomy: reviewer failed, allowing stop. ${result.error}\n`);
  log(`fail-open: ${result.error}`);
  exit(0);
}

// A violation without a usable file path conservatively flags everything.
const flagged = result.violations.map((v) => String(v.file || "").replace(/\\/g, "/").replace(/^[ab]\//, ""));
const isFlagged = (f) => flagged.some((vf) => !vf || vf === f || f.endsWith("/" + vf) || vf.endsWith("/" + f));

for (const p of reviewable) {
  if (!isFlagged(p.file)) state[p.file] = p.hash;
}
writeState(stateFile, state);

if (result.violations.length === 0) {
  clearCounter(counter);
  log(`pass: reviewed ${reviewable.map((p) => p.file).join(", ")}`);
  exit(0);
}

bumpCounter(counter, attempts + 1);
// Log the rule ids (with counts) so a suspected bad flag is diagnosable from the log alone.
const ruleCounts = {};
for (const v of result.violations) ruleCounts[v.rule || "comment"] = (ruleCounts[v.rule || "comment"] || 0) + 1;
const ruleSummary = Object.entries(ruleCounts).map(([r, n]) => (n > 1 ? `${r} x${n}` : r)).join(", ");
log(`block: ${result.violations.length} violation(s) [${ruleSummary}] in ${reviewable.map((p) => p.file).join(", ")}, attempt ${attempts + 1}/${maxAttempts}`);

block(result.violations);
