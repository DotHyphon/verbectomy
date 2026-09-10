#!/usr/bin/env node
// Background reviewer, spawned detached by the Stop hook in async mode: runs the
// model call off the turn and leaves its verdict in the findings file.
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  loadRules,
  statePath,
  readState,
  writeState,
  docStylesForFiles,
  buildReviewPrompt,
  runReviewer,
  findingsPath,
  writeFindings,
  clearFindings,
  lockPath,
  releaseLock,
  TMP,
  logRun,
} from "./lib.mjs";

const t0 = Date.now();
const payloadFile = process.argv[2];

let payload;
try {
  payload = JSON.parse(readFileSync(payloadFile, "utf8"));
} catch {
  process.exit(0);
}

const { cwd, sessionId, pieces = [], userMsgs = [] } = payload;
const sid = String(sessionId || "nosession").slice(0, 8);
const log = (msg) => logRun(`worker[${sid}] ${msg} (${Date.now() - t0}ms)`);
const lock = lockPath(sessionId);
const findings = findingsPath(sessionId);

// Also sweeps payloads a killed worker never got to delete; free to do here
// because nothing is waiting on this process.
const cleanup = () => {
  releaseLock(lock);
  try {
    rmSync(payloadFile);
  } catch {}
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of readdirSync(TMP)) {
      if (!name.startsWith("verbectomy-payload-")) continue;
      const p = join(TMP, name);
      if (statSync(p).mtimeMs < cutoff) rmSync(p);
    }
  } catch {}
};

// Marks files reviewed-clean without clobbering a baseline the inject hook has
// written while this worker was running.
const markClean = (files) => {
  const p = statePath(sessionId);
  const state = readState(p);
  for (const f of files) {
    const piece = pieces.find((x) => x.file === f);
    if (piece) state[f] = piece.hash;
  }
  writeState(p, state);
};

const finish = (code = 0) => {
  cleanup();
  process.exit(code);
};

if (!pieces.length) finish();

const cfg = loadConfig(cwd);
const diff = pieces.map((p) => p.text).join("\n");
const prompt = buildReviewPrompt({
  rules: loadRules(cwd),
  diff,
  styles: docStylesForFiles(pieces.map((p) => p.file)),
  requireDoc: cfg.requireDoc,
  userMsgs,
});

const result = runReviewer({ prompt, model: cfg.model, cwd, timeoutMs: 300000 });

if (!result.ok) {
  log(`fail-open: ${result.error}`);
  finish();
}

// A violation without a usable file path conservatively flags everything.
const flagged = result.violations.map((v) => String(v.file || "").replace(/\\/g, "/").replace(/^[ab]\//, ""));
const isFlagged = (f) => flagged.some((vf) => !vf || vf === f || f.endsWith("/" + vf) || vf.endsWith("/" + f));

markClean(pieces.filter((p) => !isFlagged(p.file)).map((p) => p.file));

if (!result.violations.length) {
  clearFindings(findings);
  log(`pass: reviewed ${pieces.map((p) => p.file).join(", ")}`);
  finish();
}

const hashes = {};
for (const p of pieces) if (isFlagged(p.file)) hashes[p.file] = p.hash;

writeFindings(findings, { ts: Date.now(), violations: result.violations, hashes });

const ruleCounts = {};
for (const v of result.violations) ruleCounts[v.rule || "comment"] = (ruleCounts[v.rule || "comment"] || 0) + 1;
const ruleSummary = Object.entries(ruleCounts)
  .map(([r, n]) => (n > 1 ? `${r} x${n}` : r))
  .join(", ");
log(`found: ${result.violations.length} violation(s) [${ruleSummary}] in ${Object.keys(hashes).join(", ")}`);
finish();
