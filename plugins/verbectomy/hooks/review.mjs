#!/usr/bin/env node
// Stop / SubagentStop hook: review the turn's changed comments with a cheap
// model, block so the agent rewrites. Only files changed since baseline; fails open.
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

const counter = counterPath("stop", input.session_id);
const stateFile = statePath(input.session_id);
const state = readState(stateFile);

const pieces = collectDiffPieces(cwd, cfg);
const pending = pieces.filter((p) => state[p.file] !== p.hash);
if (pending.length === 0) {
  clearCounter(counter);
  log(`skip: ${pieces.length} changed file(s), none new since baseline/last pass`);
  exit(0);
}

// Cap retries BEFORE spending a model call, so a stubborn false positive can't trap the user.
const attempts = readCounter(counter);
if (attempts >= maxAttempts) {
  clearCounter(counter);
  process.stderr.write(`verbectomy: max attempts (${maxAttempts}) reached, allowing stop.\n`);
  log(`gave up: max attempts (${maxAttempts}) reached, violations may stand`);
  exit(0);
}

// Over the size limit, skip auto-review: a partial review silently misses
// violations. Mark hashes so the notice fires once per version, not every stop.
const totalChars = pending.reduce((n, p) => n + p.text.length, 0);
if (maxDiffChars > 0 && totalChars > maxDiffChars) {
  for (const p of pending) state[p.file] = p.hash;
  writeState(stateFile, state);
  clearCounter(counter);
  const note = `automated comment review skipped: changes too large (${totalChars} chars, over the ${maxDiffChars} limit). Run /verbectomy-review ${pending.map((p) => p.file).join(" ")} to review these files`;
  process.stderr.write(`verbectomy: ${note}.\n`);
  log(`skip: ${note}`);
  exit(0);
}

const sent = pending;
const diff = sent.map((p) => p.text).join("\n");

const styles = docStylesForFiles(sent.map((p) => p.file));
const rules = loadRules(cwd);
const userMsgs = recentUserMessages(input.transcript_path);
const prompt = buildReviewPrompt({ rules, diff, styles, requireDoc: cfg.requireDoc, userMsgs });

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

for (const p of sent) {
  if (!isFlagged(p.file)) state[p.file] = p.hash;
}
writeState(stateFile, state);

if (result.violations.length === 0) {
  clearCounter(counter);
  log(`pass: reviewed ${sent.map((p) => p.file).join(", ")}`);
  exit(0);
}

bumpCounter(counter, attempts + 1);
// Log the rule ids (with counts) so a suspected bad flag is diagnosable from the log alone.
const ruleCounts = {};
for (const v of result.violations) ruleCounts[v.rule || "comment"] = (ruleCounts[v.rule || "comment"] || 0) + 1;
const ruleSummary = Object.entries(ruleCounts).map(([r, n]) => (n > 1 ? `${r} x${n}` : r)).join(", ");
log(`block: ${result.violations.length} violation(s) [${ruleSummary}] in ${sent.map((p) => p.file).join(", ")}, attempt ${attempts + 1}/${maxAttempts}`);

const list = result.violations
  .map((v) => `- ${v.file || "?"}${v.line ? ":" + v.line : ""} [${v.rule || "comment"}${v.fix ? ", fix: " + v.fix : ""}] ${v.why || ""}\n    > ${(v.text || "").trim()}`)
  .join("\n");

const reason =
  `verbectomy found ${result.violations.length} contract violation(s). Apply each violation's fix: ` +
  `'shrink' rewrites smaller keeping the insight, 'delete' removes. Then stop. ` +
  `User-approved comments stay as approved; stop again unchanged if flagged.\n\n${list}`;

process.stdout.write(JSON.stringify({ decision: "block", reason }));
exit(0);
