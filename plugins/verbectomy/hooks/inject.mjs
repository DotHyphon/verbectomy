#!/usr/bin/env node
// UserPromptSubmit: inject the comment contract into context. stdout on this
// event is added as context the model sees, so this is the prevention layer.
// A new user prompt starts a new turn, so retry counters reset here too.
import {
  isChild,
  loadRules,
  loadConfig,
  readInput,
  counterPath,
  clearCounter,
  statePath,
  readState,
  writeState,
  collectDiffPieces,
  detectProjectDocStyles,
  docHintText,
  findingsPath,
  readFindings,
  formatViolations,
  violationInstruction,
  logRun,
} from "./lib.mjs";

if (isChild()) process.exit(0);

const input = await readInput();
const cwd = input.cwd || process.cwd();
const cfg = loadConfig(cwd);

clearCounter(counterPath("stop", input.session_id));
clearCounter(counterPath("commit", input.session_id));

// A background review from the last turn that found something. Delivering it
// here is what makes async enforcement land: the agent fixes the comments at the
// top of this turn. The findings file stays until resolved, so ignoring this
// still meets a block at the next stop.
const findings = readFindings(findingsPath(input.session_id));
const findingsBlock = findings
  ? `${violationInstruction(findings.violations.length)} These are from the previous turn's ` +
    `comment review; fix them before the rest of this prompt.\n\n${formatViolations(findings.violations)}\n\n`
  : "";
if (findings) logRun(`inject[${String(input.session_id || "nosession").slice(0, 8)}] delivered ${findings.violations.length} violation(s) from background review`);

// Baseline the working tree: whatever is already changed or untracked at
// prompt time was not written by this turn, so the Stop reviewer must not
// flag it. The turn's own edits change these hashes and get reviewed.
// Flagged files are left out, so a fix is re-reviewed even if it restores a
// hash that was already baselined.
const stateFile = statePath(input.session_id);
const state = readState(stateFile);
const flagged = new Set(Object.keys(findings?.hashes || {}));
for (const p of collectDiffPieces(cwd, cfg)) if (!flagged.has(p.file)) state[p.file] = p.hash;
writeState(stateFile, state);

if (cfg.injectContract === false) {
  if (findingsBlock) process.stdout.write(findingsBlock);
  process.exit(0);
}

const rules = loadRules(cwd);
if (!rules) {
  if (findingsBlock) process.stdout.write(findingsBlock);
  process.exit(0);
}

const styles = detectProjectDocStyles(cwd, cfg);
const styleLine = styles.length
  ? `\nThis project's doc-comment style: ${docHintText(styles)}. Ignore doc conventions of other languages.`
  : "";
const docLine = cfg.requireDoc
  ? "\nThis project has requireDoc ON: public functions/classes/interfaces need doc-comments" +
    `${styles.length ? ` (${docHintText(styles)})` : " in the language's native doc style"}; ` +
    "private/internal/override members and test sources are exempt."
  : "";

process.stdout.write(
  findingsBlock +
    "Follow this Code Comment Contract for every comment you write or edit. A Stop-hook " +
    "reviewer validates the diff and will send violations back for you to rewrite.\n\n" +
    rules +
    styleLine +
    docLine +
    "\n"
);
process.exit(0);
