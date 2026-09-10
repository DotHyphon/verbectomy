// Run with: npm test  (node --test "plugins/verbectomy/hooks/*.test.mjs")
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  globToRe,
  makeFileFilter,
  isGitCommitCommand,
  extractCommitMessage,
  docStylesForFiles,
  detectProjectDocStyles,
  docHintText,
  recentUserMessages,
  collectWholeFilePieces,
  parseCmdShimTarget,
  pieceMayHaveComments,
  findingsAreStale,
  formatViolations,
  workerRunning,
  readFindings,
  writeFindings,
  clearFindings,
  findingsPath,
  markDelivered,
  waitForFindings,
} from "./lib.mjs";

test("globToRe basics", () => {
  assert.ok(globToRe("*.ts").test("app.ts"));
  assert.ok(!globToRe("*.ts").test("src/app.ts"));
  assert.ok(globToRe("**/test/**").test("src/test/x.kt"));
  assert.ok(globToRe("*.spec.*").test("foo.spec.ts"));
  assert.ok(!globToRe("*.ts").test("app.tsx"));
});

test("makeFileFilter includes sources, excludes tests and vendored dirs", () => {
  const included = makeFileFilter({
    sourceGlobs: ["*.ts", "*.md"],
    excludeGlobs: ["**/test/**", "*.spec.*", "**/node_modules/**"],
  });
  assert.ok(included("src/app.ts"));
  assert.ok(included("README.md"));
  assert.ok(included("app.ts"));
  assert.ok(!included("src/test/app.ts"));
  assert.ok(!included("src/app.spec.ts"));
  assert.ok(!included("node_modules/pkg/index.ts"));
  assert.ok(!included("src/app.py"));
  assert.ok(included("src\\deep\\app.ts"), "backslash paths normalise");
});

test("parseCmdShimTarget extracts the cli.js an npm shim launches", () => {
  const shim = [
    "@ECHO off",
    'SETLOCAL',
    'IF EXIST "%~dp0\\node.exe" (SET "_prog=%~dp0\\node.exe") ELSE (SET "_prog=node")',
    '"%_prog%"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ].join("\n");
  assert.equal(
    parseCmdShimTarget(shim, "C:/npm/bin"),
    "C:/npm/bin/node_modules/@anthropic-ai/claude-code/cli.js"
  );
  assert.equal(parseCmdShimTarget('"%dp0%\\cli.js" %*', "C:/x"), "C:/x/cli.js");
  assert.equal(parseCmdShimTarget("@echo off\nclaude %*", "C:/x"), null);
});

test("isGitCommitCommand", () => {
  assert.ok(isGitCommitCommand('git commit -m "x"'));
  assert.ok(isGitCommitCommand('git add -A && git commit -am "x"'));
  assert.ok(isGitCommitCommand("git commit -F - <<'EOF'\nmsg\nEOF"));
  assert.ok(!isGitCommitCommand("git log --oneline"));
  assert.ok(!isGitCommitCommand("git log | grep commit"));
  assert.ok(!isGitCommitCommand("echo hello"));
  assert.ok(
    !isGitCommitCommand("cat <<'EOF'\ngit commit -m fake\nEOF"),
    "heredoc body cannot fake a commit"
  );
});

test("extractCommitMessage: -m variants", () => {
  assert.equal(extractCommitMessage(`git commit -m 'hello world'`), "hello world");
  assert.equal(extractCommitMessage(`git commit -m "hello world"`), "hello world");
  assert.equal(extractCommitMessage(`git commit -am "combined flag"`), "combined flag");
  assert.equal(extractCommitMessage(`git commit --message="eq form"`), "eq form");
  assert.equal(extractCommitMessage(`git commit -m oneword`), "oneword");
  assert.equal(
    extractCommitMessage(`git commit -m "subject" -m "body line"`),
    "subject\n\nbody line"
  );
  assert.equal(extractCommitMessage(`git commit -m "say \\"hi\\""`), 'say "hi"');
});

test("extractCommitMessage: heredoc and PowerShell here-string", () => {
  const bash = `git commit -m "$(cat <<'EOF'\nSubject line\n\nBody here.\nEOF\n)"`;
  assert.equal(extractCommitMessage(bash), "Subject line\n\nBody here.");
  const ps = `git commit -m @'\nSubject line\n\nBody here.\n'@`;
  assert.equal(extractCommitMessage(ps), "Subject line\n\nBody here.");
});

test("extractCommitMessage: no message forms", () => {
  assert.equal(extractCommitMessage("git commit --amend --no-edit"), "");
  assert.equal(extractCommitMessage("git commit"), "");
  assert.equal(extractCommitMessage("git commit -F -"), "");
});

test("docStylesForFiles maps extensions and dedupes JS under TS", () => {
  const ts = docStylesForFiles(["src/app.ts", "src/util.mjs"]);
  assert.deepEqual(ts.map((s) => s.lang), ["TypeScript"]);
  const kt = docStylesForFiles(["Main.kt"]);
  assert.equal(kt[0].lang, "Kotlin");
  assert.equal(docStylesForFiles(["README.txt"]).length, 0);
  assert.ok(docHintText(ts).includes("TSDoc"));
});

test("detectProjectDocStyles honours languages override", () => {
  const styles = detectProjectDocStyles(".", { languages: ["typescript", "Go"] });
  assert.deepEqual(styles.map((s) => s.lang).sort(), ["Go", "TypeScript"]);
});

test("recentUserMessages skips tool results, wrappers, and meta entries", () => {
  const p = join(tmpdir(), "verbectomy-test-transcript.jsonl");
  writeFileSync(
    p,
    [
      '{"type":"user","message":{"role":"user","content":"first real message"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}',
      '{"type":"user","isMeta":true,"message":{"role":"user","content":"meta noise"}}',
      '{"type":"user","message":{"role":"user","content":"<local-command-stdout>noise</local-command-stdout>"}}',
      "not json at all",
      '{"type":"user","message":{"role":"user","content":"keep that comment"}}',
    ].join("\n"),
    "utf8"
  );
  assert.deepEqual(recentUserMessages(p), ["first real message", "keep that comment"]);
  assert.deepEqual(recentUserMessages(p, 1), ["keep that comment"]);
  rmSync(p);
  assert.deepEqual(recentUserMessages("Z:/nope/missing.jsonl"), []);
});

test("collectWholeFilePieces reads explicit paths, skips binary and missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "verbectomy-whole-"));
  writeFileSync(join(dir, "good.js"), "const x = 1;\n// note\n", "utf8");
  writeFileSync(join(dir, "bin.js"), "has a \0 null byte", "utf8");
  const pieces = collectWholeFilePieces(dir, {}, ["good.js", "bin.js", "missing.js"]);
  assert.deepEqual(pieces.map((p) => p.file), ["good.js"], "binary and missing files are dropped");
  assert.ok(pieces[0].text.startsWith("--- FILE: good.js ---\n"));
  assert.ok(pieces[0].text.includes("+const x = 1;"), "body lines are prefixed with +");
  rmSync(dir, { recursive: true, force: true });
});

test("detectProjectDocStyles returns [] for a dir with no marker files", () => {
  // The hooks dir has no package.json/tsconfig; detection must not throw and
  // returns [] rather than guessing.
  const styles = detectProjectDocStyles(import.meta.dirname ?? ".", {});
  assert.ok(Array.isArray(styles));
});

test("pieceMayHaveComments keeps anything that could hold a comment", () => {
  const may = (file, text) => pieceMayHaveComments({ file, text });
  assert.ok(!may("a.js", "@@ -1,2 +1,2 @@\n-const x = 1;\n+const x = 2;\n"));
  assert.ok(!may("a.py", "@@\n-total = a + b\n+total = a * b\n"), "a bare * is not comment syntax");
  assert.ok(may("a.js", "@@\n+// note\n"));
  assert.ok(may("a.py", "@@\n+x = 1  # note\n"));
  assert.ok(may("a.sql", "@@\n+-- grant\n"));
  assert.ok(may("a.js", "@@\n+ * continued doc line\n"), "doc-block continuation has no // of its own");
  assert.ok(may("a.py", '@@\n """doc"""\n+  prose inside a docstring\n'), "block delimiter in context");
  assert.ok(may("README.md", "@@\n+Some prose.\n"), "markdown is reviewed as prose");
  assert.ok(!may("a.js", "--- a/a.js\n+++ b/a.js\n@@\n+const x = 2;\n"), "diff headers are not markers");
});

test("findingsAreStale only when every flagged file has changed", () => {
  const findings = { hashes: { "a.js": "h1", "b.js": "h2" } };
  const at = (a, b) => [{ file: "a.js", hash: a }, { file: "b.js", hash: b }];
  assert.ok(!findingsAreStale(findings, at("h1", "h2")), "untouched findings stand");
  assert.ok(!findingsAreStale(findings, at("new", "h2")), "one file left alone still blocks");
  assert.ok(findingsAreStale(findings, at("new", "new2")));
  assert.ok(findingsAreStale(findings, []), "files reverted or committed away are stale");
  assert.ok(!findingsAreStale({ hashes: {} }, []), "no recorded hashes is never stale");
});

test("findings round-trip and empty violations read as nothing pending", () => {
  const p = findingsPath("test-session");
  writeFindings(p, { ts: 1, violations: [{ file: "a.js", rule: "narration" }], hashes: { "a.js": "h" } });
  assert.equal(readFindings(p).violations.length, 1);
  writeFindings(p, { ts: 1, violations: [], hashes: {} });
  assert.equal(readFindings(p), null, "a clean verdict is not a pending finding");
  clearFindings(p);
  assert.equal(readFindings(p), null);
});

test("workerRunning expires a stale lock", () => {
  const p = join(tmpdir(), "verbectomy-test-worker.lock");
  writeFileSync(p, "123", "utf8");
  assert.ok(workerRunning(p));
  assert.ok(!workerRunning(p, Date.now() + 60 * 60 * 1000), "a killed worker cannot wedge reviews off");
  rmSync(p);
  assert.ok(!workerRunning(p), "no lock means no worker");
});

test("formatViolations renders location, rule, fix, and the offending text", () => {
  const out = formatViolations([
    { file: "a.js", line: 12, rule: "restatement", fix: "delete", why: "says what the code says", text: "  // increment i  " },
  ]);
  assert.equal(out, "- a.js:12 [restatement, fix: delete] says what the code says\n    > // increment i");
  assert.equal(formatViolations([{}]), "- ? [comment] \n    > ", "a violation missing every field still renders");
});

test("markDelivered flags a verdict so it is reported once, not per tool call", () => {
  const p = findingsPath("test-delivered");
  const findings = { ts: 1, violations: [{ file: "a.js" }], hashes: { "a.js": "h" } };
  writeFindings(p, findings);
  assert.equal(readFindings(p).delivered, undefined);
  markDelivered(p, findings);
  const after = readFindings(p);
  assert.equal(after.delivered, true);
  assert.equal(after.violations.length, 1, "the verdict itself survives as the stop-hook backstop");
  clearFindings(p);
});

test("waitForFindings returns early when a verdict is already in, and gives up on timeout", () => {
  const p = findingsPath("test-wait");
  clearFindings(p);
  const t0 = Date.now();
  assert.equal(waitForFindings(p, 300), null);
  assert.ok(Date.now() - t0 >= 250, "it actually waited out the budget");
  writeFindings(p, { ts: 1, violations: [{ file: "a.js" }], hashes: {} });
  const t1 = Date.now();
  assert.equal(waitForFindings(p, 5000).violations.length, 1);
  assert.ok(Date.now() - t1 < 250, "a verdict already in hand costs no wait");
  clearFindings(p);
});
