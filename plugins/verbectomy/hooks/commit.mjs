#!/usr/bin/env node
// PreToolUse (Bash/PowerShell): review the message of a `git commit` before it
// runs and deny verbose ones so the message is fixed before the commit lands,
// not amended after. Fails open: anything unexpected allows the commit.
import {
  isChild,
  loadConfig,
  loadRules,
  readInput,
  counterPath,
  readCounter,
  bumpCounter,
  clearCounter,
  isGitCommitCommand,
  extractCommitMessage,
  runReviewer,
  logRun,
} from "./lib.mjs";

const t0 = Date.now();
const allow = () => process.exit(0);
if (isChild()) allow();

const input = await readInput();
const sid = String(input.session_id || "nosession").slice(0, 8);
const log = (msg) => logRun(`commit [${sid}] ${msg} (${Date.now() - t0}ms)`);
if (!["Bash", "PowerShell"].includes(input.tool_name)) allow();
const cmd = input.tool_input?.command || "";
const cwd = input.cwd || process.cwd();

// Only a git commit that carries its own message. Amend/editor commits that
// reuse an existing message have nothing new to review.
if (!isGitCommitCommand(cmd)) allow();

const cfg = loadConfig(cwd);
if (cfg.reviewCommits === false) allow();

const message = extractCommitMessage(cmd, cwd).trim();
if (!message) allow();

const maxAttempts = cfg.maxAttempts ?? 3;
const counter = counterPath("commit", input.session_id);
const attempts = readCounter(counter);
if (attempts >= maxAttempts) {
  clearCounter(counter);
  process.stderr.write(`verbectomy: max commit attempts (${maxAttempts}) reached, allowing.\n`);
  allow();
}

const rules = loadRules(cwd);
const prompt = [
  "Review ONE git commit message against the 'Git commit messages' section of the contract below.",
  "Ignore all other sections except where they clarify verbosity or narration.",
  "",
  "=== CONTRACT ===",
  rules,
  "",
  "=== COMMIT MESSAGE ===",
  message,
  "",
  "=== TASK ===",
  'Return ONLY a JSON object, no prose, no code fences: {"violations":[{"rule":"short-id","why":"one line"}]}',
  "Empty array if the message complies. Do not invent violations.",
].join("\n");

const result = runReviewer({ prompt, model: cfg.model, cwd, maxBuffer: 16 * 1024 * 1024 });
if (!result.ok) {
  process.stderr.write(`verbectomy: commit reviewer failed, allowing. ${result.error}\n`);
  log(`fail-open: ${result.error}`);
  allow();
}

if (result.violations.length === 0) {
  clearCounter(counter);
  log("pass: commit message reviewed");
  allow();
}

bumpCounter(counter, attempts + 1);
log(`deny: ${result.violations.length} violation(s), attempt ${attempts + 1}/${maxAttempts}`);
const list = result.violations.map((v) => `- [${v.rule || "commit"}] ${v.why || ""}`).join("\n");
const reason =
  `verbectomy: this commit message has ${result.violations.length} contract violation(s). Rewrite it ` +
  `(imperative subject <= 50 chars, body only for the non-obvious WHY, no filler, no decision ` +
  `narration, no em dashes) and re-run the commit:\n\n${list}`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })
);
process.exit(0);
