#!/usr/bin/env node
// PostToolUse: start the review at the edit, not the stop, so its verdict can land
// mid-turn while there is still a turn to fix it in. Fails open.
import {
  isChild,
  loadConfig,
  readInput,
  collectDiffPieces,
  recentUserMessages,
  findingsPath,
  readFindings,
  markDelivered,
  findingsAreStale,
  queueReview,
  formatViolations,
  violationInstruction,
  logRun,
} from "./lib.mjs";

const t0 = Date.now();
const exit = (code = 0) => process.exit(code);
if (isChild()) exit();

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Update"];

const input = await readInput();
const cwd = input.cwd || process.cwd();
const sid = String(input.session_id || "nosession").slice(0, 8);
const log = (msg) => logRun(`edit  [${sid}] ${msg} (${Date.now() - t0}ms)`);
const cfg = loadConfig(cwd);

// Sync mode keeps every review on the stop hook, so there is nothing to start
// or deliver here.
if (cfg.asyncReview === false || cfg.earlyReview === false) exit();

const findingsFile = findingsPath(input.session_id);
const findings = readFindings(findingsFile);

// Deliver first: a verdict in hand is worth more than starting another review.
if (findings && !findings.delivered && !findingsAreStale(findings, collectDiffPieces(cwd, cfg))) {
  markDelivered(findingsFile, findings);
  log(`delivered ${findings.violations.length} violation(s) mid-turn`);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `${violationInstruction(findings.violations.length)} These are from the background ` +
          `comment review of your own edits this turn. Fix them now, before you stop.\n\n` +
          formatViolations(findings.violations),
      },
    })
  );
  exit();
}

if (!EDIT_TOOLS.includes(input.tool_name)) exit();

const result = queueReview({
  cwd,
  cfg,
  sessionId: input.session_id,
  userMsgs: recentUserMessages(input.transcript_path),
});

if (result.queued) log(`queued: ${result.queued} file(s) to background reviewer pid ${result.pid}`);
else if (result.error) log(`fail-open: worker spawn failed, ${result.error}`);
exit();
