#!/usr/bin/env node
// On-demand review for /verbectomy-review: ignores the per-turn baseline and
// reviews a user-named scope, batching large ones to fit the model's context.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  loadRules,
  collectDiffPieces,
  collectWholeFilePieces,
  mergeBase,
  docStylesForFiles,
  buildReviewPrompt,
  runReviewer,
} from "./lib.mjs";

const cwd = process.cwd();
const argv = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`verbectomy-review: ${msg}\n`);
  process.exit(2);
};

let scope = null;
let model = null;
let baseRef = null;
let commitRef = null;
let maxBatch = null;
let timeoutMs = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--repo" || a === "--all") scope = "repo";
  else if (a === "--diff") scope = "diff";
  else if (a === "--base" || a === "--branch") (scope = "base"), (baseRef = argv[++i]);
  else if (a === "--commit") (scope = "commit"), (commitRef = argv[++i]);
  else if (a === "--scope") scope = argv[++i];
  else if (a === "--model") model = argv[++i];
  else if (a === "--max-batch") maxBatch = parseInt(argv[++i], 10) || null;
  else if (a === "--timeout") timeoutMs = parseInt(argv[++i], 10) || null;
  else if (a.startsWith("--")) die(`unknown flag '${a}'. Flags: --repo | --diff | --base <ref> | --commit <sha> | <file>...`);
  else files.push(a);
}
if (!scope) scope = files.length ? "files" : "diff";

if ((scope === "base" && !baseRef) || (scope === "commit" && !commitRef))
  die(`${scope === "base" ? "--base" : "--commit"} needs a git ref argument`);

// Reject prose masquerading as paths before spending a model call: a scope
// phrase arrives as many non-path tokens, so name them and point at the flag.
if (scope === "files") {
  const isPathish = (f) => /[*?[\]]/.test(f) || existsSync(join(cwd, f));
  const bad = files.filter((f) => !isPathish(f));
  if (bad.length)
    die(
      `not a file or glob: ${bad.map((b) => JSON.stringify(b)).join(", ")}. ` +
        `For a branch's comments use --base <ref> (e.g. --base main); whole repo --repo; working diff no args.`
    );
}

const cfg = loadConfig(cwd);
const rules = loadRules(cwd);
model = model || cfg.model || "haiku";
maxBatch = maxBatch || 50000;
// cmd.exe-shimmed spawns on Windows are slower to start, so a bare-metal batch
// needs more headroom than posix before the split-on-timeout path kicks in.
timeoutMs = timeoutMs || (process.platform === "win32" ? 180000 : 120000);

let pieces;
if (scope === "diff") pieces = collectDiffPieces(cwd, cfg);
else if (scope === "repo") pieces = collectWholeFilePieces(cwd, cfg, null);
else if (scope === "base") {
  const mb = mergeBase(cwd, baseRef);
  if (!mb) die(`cannot find a merge-base of '${baseRef}' and HEAD (unknown ref?)`);
  pieces = collectDiffPieces(cwd, cfg, { revs: [mb] });
} else if (scope === "commit") pieces = collectDiffPieces(cwd, cfg, { revs: [`${commitRef}^`, commitRef], includeUntracked: false });
else pieces = collectWholeFilePieces(cwd, cfg, files);

if (!pieces.length) {
  const what =
    scope === "diff"
      ? "uncommitted changes"
      : scope === "repo"
        ? "matching source files"
        : scope === "base"
          ? `comments added since '${baseRef}'`
          : scope === "commit"
            ? `changes in '${commitRef}'`
            : "readable files at the given paths";
  console.log(`verbectomy-review (${scope}): no ${what} to review.`);
  process.exit(0);
}

// Greedy batch by char count so a big scope splits across reviewer calls; one
// oversized file still ships alone rather than being dropped.
const batches = [];
let cur = [];
let curLen = 0;
for (const p of pieces) {
  if (cur.length && curLen + p.text.length > maxBatch) {
    batches.push(cur);
    cur = [];
    curLen = 0;
  }
  cur.push(p);
  curLen += p.text.length;
}
if (cur.length) batches.push(cur);

const violations = [];
const failedFiles = [];

// A multi-file batch that times out is usually just size: halve and retry each
// half. A lone file gets one longer retry, then counts as incomplete, not clean.
function reviewBatch(batch, tmo) {
  const diff = batch.map((p) => p.text).join("\n");
  const styles = docStylesForFiles(batch.map((p) => p.file));
  const prompt = buildReviewPrompt({ rules, diff, styles, requireDoc: cfg.requireDoc });
  let res = runReviewer({ prompt, model, cwd, timeoutMs: tmo });
  if (!res.ok && res.timedOut) {
    if (batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      process.stderr.write(`verbectomy-review: batch of ${batch.length} timed out at ${tmo}ms, splitting into ${mid}+${batch.length - mid}...\n`);
      reviewBatch(batch.slice(0, mid), tmo);
      reviewBatch(batch.slice(mid), tmo);
      return;
    }
    process.stderr.write(`verbectomy-review: ${batch[0].file} timed out at ${tmo}ms, retrying once...\n`);
    res = runReviewer({ prompt, model, cwd, timeoutMs: Math.round(tmo * 1.5) });
  }
  if (!res.ok) {
    failedFiles.push(...batch.map((p) => p.file));
    process.stderr.write(`verbectomy-review: batch failed (${res.error}) for ${batch.map((p) => p.file).join(", ")}\n`);
    return;
  }
  for (const v of res.violations) violations.push(v);
}

for (const batch of batches) reviewBatch(batch, timeoutMs);

const reviewed = pieces.length - failedFiles.length;
if (failedFiles.length) {
  console.log(
    `verbectomy-review (${scope}): INCOMPLETE: ${failedFiles.length} of ${pieces.length} file(s) could not be reviewed ` +
      `(${failedFiles.join(", ")}). ${violations.length} violation(s) in the ${reviewed} that finished, via ${model}.`
  );
} else {
  console.log(`verbectomy-review (${scope}): ${pieces.length} file(s) via ${model}, ${violations.length} violation(s).`);
}
for (const v of violations) {
  const loc = `${v.file || "?"}${v.line ? ":" + v.line : ""}`;
  console.log(`- ${loc} [${v.rule || "comment"}${v.fix ? ", " + v.fix : ""}] ${v.why || ""}`);
  if (v.text) console.log(`    > ${String(v.text).trim()}`);
}
process.exit(failedFiles.length ? 2 : 0);
