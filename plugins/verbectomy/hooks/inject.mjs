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
} from "./lib.mjs";

if (isChild()) process.exit(0);

const input = await readInput();
const cwd = input.cwd || process.cwd();
const cfg = loadConfig(cwd);

clearCounter(counterPath("stop", input.session_id));
clearCounter(counterPath("commit", input.session_id));

// Baseline the working tree: whatever is already changed or untracked at
// prompt time was not written by this turn, so the Stop reviewer must not
// flag it. The turn's own edits change these hashes and get reviewed.
const stateFile = statePath(input.session_id);
const state = readState(stateFile);
for (const p of collectDiffPieces(cwd, cfg)) state[p.file] = p.hash;
writeState(stateFile, state);

if (cfg.injectContract === false) process.exit(0);

const rules = loadRules(cwd);
if (!rules) process.exit(0);

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
  "Follow this Code Comment Contract for every comment you write or edit. A Stop-hook " +
    "reviewer validates the diff and will send violations back for you to rewrite.\n\n" +
    rules +
    styleLine +
    docLine +
    "\n"
);
process.exit(0);
