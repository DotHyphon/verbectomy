#!/usr/bin/env node
// Eval harness: run a labelled corpus of real-world comments through the exact
// reviewer prompt the Stop hook ships, and report where the verdict disagrees
// with the label. Needs the `claude` CLI (same as the hook). Nothing here is
// wired into the plugin at runtime; it exists to calibrate comment-rules.md.
//
//   node plugins/verbectomy/eval/run.mjs [--model haiku] [--concurrency 6]
//                                        [--filter <substr>] [--only-fails]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewPrompt, docStylesForFiles, CHILD_FLAG } from "../hooks/lib.mjs";
import { CORPUS } from "./corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(HERE, "..", "comment-rules.md"), "utf8");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const model = arg("--model", "haiku");
const concurrency = parseInt(arg("--concurrency", "6"), 10);
const filter = arg("--filter", "");
const onlyFails = process.argv.includes("--only-fails");

// Render an example as the diff text the hook would collect: raw `diff` if the
// case needs deletions/context, else the body as an all-added new file.
function toDiff(ex) {
  if (ex.diff) return ex.diff;
  const body = ex.code.replace(/^\n/, "").replace(/\n$/, "");
  return `--- NEW FILE: ${ex.file} ---\n` + body.split("\n").map((l) => "+" + l).join("\n") + "\n";
}

// Async twin of lib.runReviewer: same argv, env, and parsing, but non-blocking
// so the corpus runs with real concurrency.
function reviewAsync(prompt) {
  return new Promise((resolve) => {
    const args = ["-p", "--model", model, "--output-format", "json", "--strict-mcp-config"];
    let child;
    try {
      child = spawn("claude", args, {
        env: { ...process.env, [CHILD_FLAG]: "1" },
        shell: process.platform === "win32",
      });
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 90000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status !== 0 || !out) return resolve({ ok: false, error: err.trim() || `exit ${status}` });
      try {
        const wrapper = JSON.parse(out);
        if (wrapper.is_error) return resolve({ ok: false, error: String(wrapper.result || "reviewer errored") });
        const text = typeof wrapper.result === "string" ? wrapper.result : out;
        const m = text.match(/\{[\s\S]*\}/);
        const violations = m ? JSON.parse(m[0]).violations : [];
        resolve({ ok: true, violations: Array.isArray(violations) ? violations : [] });
      } catch (e) {
        resolve({ ok: false, error: `unparseable: ${e.message}` });
      }
    });
    child.stdin.end(prompt.replace(/\0/g, ""));
  });
}

async function runOne(ex) {
  const diff = toDiff(ex);
  const styles = docStylesForFiles([ex.file]);
  const prompt = buildReviewPrompt({ rules: RULES, diff, styles, requireDoc: !!ex.requireDoc });
  const res = await reviewAsync(prompt);
  if (!res.ok) return { ex, verdict: "error", error: res.error, violations: [] };
  const got = res.violations.length ? "flag" : "pass";
  return { ex, verdict: got === ex.expect ? "ok" : "MISMATCH", got, violations: res.violations };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
      process.stderr.write(".");
    }
  });
  await Promise.all(workers);
  process.stderr.write("\n");
  return results;
}

const needles = filter ? filter.split(",").map((s) => s.trim()).filter(Boolean) : [];
const cases = CORPUS.filter((ex) => !needles.length || needles.some((n) => ex.id.includes(n) || (ex.file || "").includes(n)));
process.stderr.write(`Running ${cases.length} case(s) through ${model} (concurrency ${concurrency})\n`);

const results = await pool(cases, concurrency, runOne);

const byLang = {};
let ok = 0;
let mismatch = 0;
let errors = 0;
for (const r of results) {
  const lang = extname(r.ex.file);
  byLang[lang] ??= { ok: 0, mismatch: 0, error: 0 };
  if (r.verdict === "ok") { ok++; byLang[lang].ok++; }
  else if (r.verdict === "error") { errors++; byLang[lang].error++; }
  else { mismatch++; byLang[lang].mismatch++; }
}

for (const r of results) {
  if (onlyFails && r.verdict === "ok") continue;
  const tag = r.verdict === "ok" ? "PASS" : r.verdict === "error" ? "ERR " : "FAIL";
  console.log(`[${tag}] ${r.ex.id}  expect=${r.ex.expect} got=${r.got ?? r.error}`);
  if (r.verdict === "MISMATCH") {
    console.log(`        ${r.ex.note}`);
    if (r.ex.expect === "flag") console.log(`        (should have been flagged as: ${(r.ex.rules || []).join(", ") || "?"})`);
    for (const v of r.violations) console.log(`        got-violation [${v.rule}/${v.fix}] ${v.why} :: ${(v.text || "").slice(0, 80)}`);
  }
}

console.log("\n=== by extension ===");
for (const [lang, c] of Object.entries(byLang).sort()) {
  console.log(`  ${lang.padEnd(10)} ok=${c.ok} mismatch=${c.mismatch} error=${c.error}`);
}
console.log(`\n=== total: ok=${ok} mismatch=${mismatch} error=${errors} / ${results.length} ===`);
process.exit(mismatch > 0 ? 1 : 0);
