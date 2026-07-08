import { readFileSync, writeFileSync, rmSync, readdirSync, appendFileSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, dirname, extname, isAbsolute, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

// Set on the child `claude -p` reviewer call so verbectomy's own hooks no-op
// inside it. Primary guard against the reviewer recursively triggering a review.
export const CHILD_FLAG = "VERBECTOMY_CHILD";
export const isChild = () => process.env[CHILD_FLAG] === "1";

// Plugin dir is copied to a cache on install, so bundled defaults resolve
// relative to this file (CLAUDE_PLUGIN_ROOT if present, else two levels up).
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(HERE, "..");
const USER_DIR = join(homedir(), ".claude");

export const TMP = tmpdir();

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const readText = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

// Config precedence, later wins: shipped default -> user ~/.claude -> project
// .claude/<cwd>. The default ships under its own name so a user override never
// shadows it wholesale; overrides are the partial verbectomy.config.json.
export function loadConfig(cwd) {
  const dflt = readJson(join(PLUGIN_ROOT, "verbectomy.config.default.json")) ?? {};
  const user = readJson(join(USER_DIR, "verbectomy.config.json"));
  const project = cwd ? readJson(join(cwd, ".claude", "verbectomy.config.json")) : null;
  return { ...dflt, ...(user ?? {}), ...(project ?? {}) };
}

// The shipped contract is always the base and cannot be replaced. User
// (~/.claude) and project (.claude) files, if present, are appended in that
// order so they add to the contract rather than shadow it.
export function loadRules(cwd) {
  const parts = [
    readText(join(PLUGIN_ROOT, "comment-rules.md")),
    readText(join(USER_DIR, "verbectomy.comment-rules.md")),
    cwd && readText(join(cwd, ".claude", "verbectomy.comment-rules.md")),
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // A hook invoked without piped stdin never fires "end"; don't hang the turn.
    setTimeout(() => resolve(data), 3000).unref?.();
  });
}

export async function readInput() {
  try {
    return JSON.parse((await readStdin()) || "{}");
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Retry counters. Session-scoped tmp files; inject.mjs clears them on every
// new user prompt so caps apply per turn, not per session.
// ---------------------------------------------------------------------------

export const counterPath = (kind, sessionId) =>
  join(TMP, `verbectomy-${kind}-${String(sessionId || "nosession").replace(/[^\w.-]/g, "_")}.count`);

export const readCounter = (p) => {
  try {
    return parseInt(readFileSync(p, "utf8"), 10) || 0;
  } catch {
    return 0;
  }
};

export const bumpCounter = (p, value) => {
  try {
    writeFileSync(p, String(value), "utf8");
  } catch {}
};

export const clearCounter = (p) => {
  try {
    rmSync(p);
  } catch {}
};

// ---------------------------------------------------------------------------
// Reviewed-state cache. Maps file -> hash of its last diff that passed review,
// so an unchanged file is never re-reviewed. This is what keeps Stop-hook
// latency flat as uncommitted changes accumulate.
// ---------------------------------------------------------------------------

export const statePath = (sessionId) =>
  join(TMP, `verbectomy-clean-${String(sessionId || "nosession").replace(/[^\w.-]/g, "_")}.json`);

export const readState = (p) => {
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
};

export const writeState = (p, state) => {
  try {
    writeFileSync(p, JSON.stringify(state), "utf8");
  } catch {}
};

export const hashText = (s) => createHash("sha1").update(s).digest("hex");

// One line per hook run so "did it trigger, what did it decide" is always
// answerable: hook outcomes are otherwise invisible when they allow.
export const LOG_FILE = join(TMP, "verbectomy.log");
export function logRun(line) {
  try {
    try {
      if (statSync(LOG_FILE).size > 1024 * 1024) rmSync(LOG_FILE);
    } catch {}
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

// Newest-last genuine user messages from the session transcript. The reviewer
// reads these so explicit user wishes ("keep that comment") beat the contract.
// Tool results, command wrappers, and injected context also arrive as
// user-type entries; anything starting with "<" is one of those, not the user.
export function recentUserMessages(transcriptPath, max = 3) {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n");
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type !== "user" || e.isMeta) continue;
      const c = e.message?.content;
      let text = "";
      if (typeof c === "string") text = c;
      else if (Array.isArray(c)) text = c.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      text = text.trim();
      if (!text || text.startsWith("<")) continue;
      out.unshift(text.length > 600 ? text.slice(0, 600) + "..." : text);
    }
    return out;
  } catch {
    return [];
  }
}

// One piece per changed file: its diff for the given `opts.revs` (default HEAD),
// or an untracked file's body. `includeUntracked` off when diffing two commits.
export function collectDiffPieces(cwd, cfg, opts = {}) {
  const revs = opts.revs ?? ["HEAD"];
  const includeUntracked = opts.includeUntracked ?? true;
  const git = (args) => {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : null;
  };
  if (!git(["rev-parse", "--is-inside-work-tree"])) return [];
  const included = makeFileFilter(cfg);
  const norm = (p) => p.replace(/\\/g, "/");
  const list = (out) => (out || "").split("\n").filter(Boolean).map(norm).filter(included);
  const tracked = list(git(["diff", "--name-only", ...revs]));
  const untracked = includeUntracked ? list(git(["ls-files", "--others", "--exclude-standard"])) : [];

  const MAX_NEW_FILE_CHARS = 200 * 1024;
  const pieces = [];
  for (const f of tracked) {
    const d = git(["diff", "--no-color", "--unified=4", ...revs, "--", f]);
    if (d && d.trim()) pieces.push({ file: f, text: d, hash: hashText(d) });
  }
  for (const f of untracked) {
    try {
      const body = readFileSync(join(cwd, f), "utf8");
      if (body.length > MAX_NEW_FILE_CHARS || body.includes("\0")) continue;
      const text = `--- NEW FILE: ${f} ---\n` + body.split("\n").map((l) => "+" + l).join("\n") + "\n";
      pieces.push({ file: f, text, hash: hashText(text) });
    } catch {}
  }
  return pieces;
}

// Merge-base of `ref` and HEAD, so a branch scope diffs against where it forked
// rather than the moved-on tip of the base. null when git can't resolve either.
export function mergeBase(cwd, ref) {
  const r = spawnSync("git", ["-C", cwd, "merge-base", ref, "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Whole-file pieces for on-demand review (the /verbectomy-review skill), which
// ignores the per-turn baseline. Explicit paths are read as given; otherwise
// every tracked or untracked file passing the filter. Each file is rendered as
// an all-added block so the reviewer prompt matches the diff path exactly.
export function collectWholeFilePieces(cwd, cfg, explicitPaths) {
  const norm = (p) => p.replace(/\\/g, "/");
  const MAX_FILE_CHARS = 200 * 1024;
  const read = (f) => {
    try {
      const body = readFileSync(join(cwd, f), "utf8");
      if (body.length > MAX_FILE_CHARS || body.includes("\0")) return null;
      const nf = norm(f);
      const text = `--- FILE: ${nf} ---\n` + body.split("\n").map((l) => "+" + l).join("\n") + "\n";
      return { file: nf, text, hash: hashText(text) };
    } catch {
      return null;
    }
  };

  let list;
  if (explicitPaths && explicitPaths.length) {
    list = explicitPaths.map(norm);
  } else {
    const git = (args) => {
      const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return r.status === 0 ? r.stdout : null;
    };
    if (!git(["rev-parse", "--is-inside-work-tree"])) return [];
    const included = makeFileFilter(cfg);
    const split = (out) => (out || "").split("\n").filter(Boolean).map(norm);
    const tracked = split(git(["ls-files"]));
    const untracked = split(git(["ls-files", "--others", "--exclude-standard"]));
    list = [...new Set([...tracked, ...untracked])].filter(included);
  }

  const pieces = [];
  for (const f of list) {
    const p = read(f);
    if (p) pieces.push(p);
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// File filtering. Minimal glob: ** crosses slashes, * within a segment,
// ? one non-slash char. Bare globs also match in subdirectories.
// ---------------------------------------------------------------------------

export const globToRe = (g) => {
  // Placeholders keep ** forms intact through escaping; `**/` and `/**` must
  // also match zero directories or `**/node_modules/**` misses a top-level one.
  const src = g.replace(/\*\*\//g, "\u0001").replace(/\/\*\*/g, "\u0002").replace(/\*\*/g, "\u0003");
  const body = src
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0002/g, "(?:/.*)?")
    .replace(/\u0003/g, ".*");
  return new RegExp("^" + body + "$");
};

export function makeFileFilter(cfg) {
  const compile = (globs) => (globs ?? []).flatMap((g) => [globToRe(g), globToRe("**/" + g)]);
  const inc = compile(cfg.sourceGlobs);
  const exc = compile(cfg.excludeGlobs);
  return (path) => {
    const n = path.replace(/\\/g, "/");
    return inc.some((r) => r.test(n)) && !exc.some((r) => r.test(n));
  };
}

// ---------------------------------------------------------------------------
// Language / doc-style awareness. "KDoc" means nothing to a TypeScript repo,
// so both the injected contract and the reviewer prompt name the doc style
// that actually applies. Detected from changed-file extensions (review) or
// project marker files (inject); `languages` in config overrides detection.
// ---------------------------------------------------------------------------

export const DOC_STYLES = [
  { lang: "TypeScript", exts: [".ts", ".tsx", ".mts", ".cts"], doc: "TSDoc `/** */` blocks", markers: ["tsconfig.json"] },
  { lang: "JavaScript", exts: [".js", ".jsx", ".mjs", ".cjs"], doc: "JSDoc `/** */` blocks", markers: ["package.json", "jsconfig.json"] },
  { lang: "Kotlin", exts: [".kt", ".kts"], doc: "KDoc `/** */` blocks", markers: ["build.gradle.kts", "settings.gradle.kts"] },
  { lang: "Java", exts: [".java"], doc: "Javadoc `/** */` blocks", markers: ["pom.xml", "build.gradle"] },
  { lang: "Python", exts: [".py"], doc: 'PEP 257 `"""docstrings"""`', markers: ["pyproject.toml", "setup.py", "requirements.txt"] },
  { lang: "Go", exts: [".go"], doc: "godoc comments (`// Name ...` above the declaration)", markers: ["go.mod"] },
  { lang: "Rust", exts: [".rs"], doc: "rustdoc `///` comments", markers: ["Cargo.toml"] },
  { lang: "C#", exts: [".cs"], doc: "XML doc comments (`/// <summary>`)", markers: ["*.csproj", "*.sln"] },
  { lang: "Ruby", exts: [".rb"], doc: "YARD `#` comments", markers: ["Gemfile"] },
  { lang: "PHP", exts: [".php"], doc: "PHPDoc `/** */` blocks", markers: ["composer.json"] },
  { lang: "Swift", exts: [".swift"], doc: "`///` markup comments", markers: ["Package.swift"] },
  { lang: "Scala", exts: [".scala"], doc: "Scaladoc `/** */` blocks", markers: ["build.sbt"] },
];

const stylesByName = (names) =>
  DOC_STYLES.filter((s) => names.some((n) => String(n).toLowerCase() === s.lang.toLowerCase()));

// A tsconfig implies package.json too; TypeScript subsumes the JSDoc hint.
const dedupe = (styles) => {
  const hasTs = styles.some((s) => s.lang === "TypeScript");
  return styles.filter((s) => !(hasTs && s.lang === "JavaScript"));
};

export function docStylesForFiles(paths) {
  const exts = new Set(paths.map((p) => extname(p).toLowerCase()));
  return dedupe(DOC_STYLES.filter((s) => s.exts.some((e) => exts.has(e))));
}

export function detectProjectDocStyles(cwd, cfg) {
  if (Array.isArray(cfg?.languages) && cfg.languages.length) return stylesByName(cfg.languages);
  let entries = [];
  try {
    entries = readdirSync(cwd || ".");
  } catch {
    return [];
  }
  const hit = (m) => (m.startsWith("*.") ? entries.some((e) => e.endsWith(m.slice(1))) : entries.includes(m));
  return dedupe(DOC_STYLES.filter((s) => s.markers.some(hit)));
}

export const docHintText = (styles) => styles.map((s) => `${s.lang}: ${s.doc}`).join("; ");

// ---------------------------------------------------------------------------
// Commit-command parsing (Bash and PowerShell).
// ---------------------------------------------------------------------------

// Heredoc/here-string bodies are blanked first so their text can't fake a
// commit, then the match is scoped to one shell statement so `git log | grep
// commit` doesn't trigger. Multi-line messages keep `git commit` and its
// heredoc opener on the same statement, so blanking the body is safe.
const stripInlineBodies = (cmd) =>
  cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?\s*\r?\n[\s\S]*?\r?\n\s*\1\b/g, " __BODY__ ")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, " __BODY__ ");

export const isGitCommitCommand = (cmd) => /\bgit\b[^\n;|&]*\bcommit\b/.test(stripInlineBodies(cmd));

export function extractCommitMessage(cmd, cwd) {
  // Bash heredoc: git commit -m "$(cat <<'EOF' ... EOF)" or -F - <<'EOF'.
  const hd = cmd.match(/<<-?\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\s*\1\b/);
  if (hd) return hd[2];
  // PowerShell here-string: -m @' ... '@ (closer must start its line).
  const ps = cmd.match(/@(['"])\r?\n([\s\S]*?)\r?\n\1@/);
  if (ps) return ps[2];
  const msgs = [];
  // -[a-zA-Z]*m covers combined short flags like -am / -sm.
  const re = /(?:^|[\s;&|(])(?:-[a-zA-Z]*m|--message)(?:=|\s+)(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s;&|]+))/g;
  let m;
  while ((m = re.exec(cmd))) msgs.push((m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(["\\])/g, "$1"));
  if (msgs.length) return msgs.join("\n\n");
  const f = cmd.match(/(?:^|\s)(?:-[a-zA-Z]*F|--file)(?:=|\s+)(?:'([^']+)'|"([^"]+)"|(\S+))/);
  const file = f && (f[1] ?? f[2] ?? f[3]);
  if (file && file !== "-") {
    try {
      return readFileSync(isAbsolute(file) ? file : join(cwd || ".", file), "utf8");
    } catch {}
  }
  return "";
}

// ---------------------------------------------------------------------------
// Reviewer prompt: harness only (strictness framing, diff/lens rules, JSON
// output schema). All comment policy lives in the injected contract (`rules`,
// from comment-rules.md), so this stays free of duplicated rule text. Shared by
// the Stop hook and the eval harness so both exercise the same instructions.
// ---------------------------------------------------------------------------

export function buildReviewPrompt({ rules, diff, styles = [], requireDoc = false, userMsgs = [] }) {
  const langHint = styles.length ? `Languages in this diff, with their doc-comment style: ${docHintText(styles)}.` : "";
  const docRule = requireDoc
    ? `\n- requireDoc is ON: flag public functions/classes/interfaces (added or modified) that lack a doc-comment in the language's native style${styles.length ? ` (${docHintText(styles)})` : ""}. Exempt private/internal/override members and test sources.`
    : "\n- requireDoc is OFF: do NOT flag missing doc-comments.";
  const userBlock = userMsgs.length
    ? [
        "=== RECENT USER MESSAGES (newest last) ===",
        "The user outranks this contract. If these messages explicitly ask for a specific comment",
        "to exist, stay, or keep its wording, do NOT flag that comment.",
        ...userMsgs.map((m) => `> ${m.replace(/\n/g, "\n> ")}`),
        "",
      ]
    : [];
  return [
    "You are a STRICT comment reviewer. The diff below was written by a model, and models",
    "over-comment by default, so assume it contains violations and hunt for them. Your own",
    "instinct that a thorough comment is a good comment is the exact bias this contract exists",
    "to correct: a comment can be true, well-written, genuinely explanatory, and still be a",
    "violation because it is bigger than the insight it carries.",
    "",
    "Judge added lines (+) AND deleted comment lines (-). Deleted CODE lines are out of scope,",
    "but a deleted comment or doc-comment is in scope. Flag rule 'doc-removed' only when real",
    "information is lost: a public declaration keeps its code but loses its doc-comment entirely,",
    "or a constraint/invariant/gotcha the code cannot show is deleted while its code remains.",
    "Shrinking is this tool's PURPOSE, so a doc-comment that was merely shortened is NOT",
    "doc-removed when a summary describing the declaration still survives and the deleted lines",
    "were rationale, history, restatement, or padding. Judge deleted text the way you judge added",
    "text: if adding those lines back would be a violation, removing them was the fix, not a loss.",
    "Reinstate only a constraint the surviving lines dropped, never prose that merely explained.",
    "- Code files: review ONLY comments and doc-comments, never the code logic itself.",
    "- Markdown/text files (.md, .mdx, .markdown): review the prose itself for the contract's concision",
    "  rules. Leave code blocks, commands, tables, headings, and links untouched.",
    "Use each file's path in the diff to decide which lens applies.",
    langHint,
    "",
    "Apply the COMMENT CONTRACT below mechanically, with no benefit of the doubt. It is the full",
    "policy: it defines every violation and every exception (how doc-comment summaries and tags are",
    "judged, when a summary is tautology, when a short constraint stands). Flag every instance it",
    "describes; take each fix (delete vs shrink) from its verdicts. When unsure whether a comment",
    "longer than two lines earns its length, it does not.",
    "",
    "Your bias is to over-flag, so the contract's exceptions are binding: do NOT flag these, they",
    "COMPLY (see the contract for the exact tests).",
    "  - a one-line doc summary that describes the declaration's behavior or return, even if it",
    "    names the declaration ('Sort sorts data...', 'Disposes of a value.', 'Return the pathname').",
    "    Judge it as a whole: one substantive clause makes it comply even next to a weaker synonym",
    "    aside ('...also referred to as its length'); flag only if the ENTIRE summary just restates.",
    "  - a doc-comment made of a one-line summary plus tags/notes that each add non-obvious info; it",
    "    is not bound by the two-line inline ceiling and is not 'oversized'.",
    "  - a doc tag that adds a detail beyond the name and type (a null/empty/error case, units, a",
    "    range, a cryptic name's meaning).",
    "  - a why, constraint, invariant, gotcha, or keep-in-sync note at or under two lines, even with",
    "    a connective word (Note that, so). Nearby code naming related things does not make it",
    "    restatement.",
    "",
    ...userBlock,
    "=== COMMENT CONTRACT ===",
    rules,
    docRule,
    "",
    "=== DIFF ===",
    diff,
    "",
    "=== TASK ===",
    "Return ONLY a JSON object, no prose, no code fences:",
    '{"violations":[{"file":"path","line":<added-line-hint or 0>,"rule":"short-rule-id","fix":"delete|shrink","text":"the offending comment","why":"one line"}]}',
    "Empty array only if every comment complies. Do not invent comments that are not in the diff; unchanged context lines are for context only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reviewer call. Returns { ok, violations } or { ok: false, error }; callers
// treat any failure as allow (fail open).
// ---------------------------------------------------------------------------

// The quoted `...\cli.js` an npm .cmd shim launches, resolved absolute. Lets us
// run `node <cli.js>` directly instead of paying a per-call cmd.exe hop.
export function parseCmdShimTarget(body, cmdDir) {
  const m = body.match(/"([^"]*\.js)"/i);
  if (!m) return null;
  const js = m[1].replace(/%~?dp0%?\\?/i, "").replace(/\\/g, "/");
  // Forward slashes both because join() would emit backslashes on Windows and
  // because spawn/existsSync accept them there anyway.
  return (isAbsolute(js) ? js : join(cmdDir, js)).replace(/\\/g, "/");
}

// Avoid a per-call cmd.exe hop on Windows (~1s): resolve a directly-spawnable
// target (claude.exe, or a shim unwrapped to `node cli.js`), else keep the shell.
let reviewerCmd;
export function resolveReviewer(env = process.env) {
  if (reviewerCmd) return reviewerCmd;
  const direct = (file, args = []) => (reviewerCmd = { file, args, shell: false });
  if (process.platform !== "win32") return direct("claude");
  const dirs = (env.PATH || "").split(delimiter).filter(Boolean);
  const find = (name) => dirs.map((d) => join(d, name)).find(existsSync) || null;
  const exe = find("claude.exe");
  if (exe) return direct(exe);
  const cmd = find("claude.cmd");
  if (cmd) {
    try {
      const js = parseCmdShimTarget(readFileSync(cmd, "utf8"), dirname(cmd));
      if (js && existsSync(js)) return direct(process.execPath, [js]);
    } catch {}
  }
  return (reviewerCmd = { file: "claude", args: [], shell: true });
}

export function runReviewer({ prompt, model, cwd, timeoutMs = 90000, maxBuffer = 32 * 1024 * 1024 }) {
  // Validate rather than quote the one variable arg: the shell fallback joins
  // argv naively, and a bad model name is worth rejecting on any path anyway.
  const safeModel = /^[A-Za-z0-9._:@-]+$/.test(model || "") ? model : "haiku";
  const { file, args: prefix, shell } = resolveReviewer();
  const args = [...prefix, "-p", "--model", safeModel, "--output-format", "json", "--strict-mcp-config"];
  let run;
  try {
    run = spawnSync(file, args, {
      // Prompt on stdin, not argv: diffs are unbounded and would blow the arg
      // limit. Null bytes crash spawn and mean nothing to the reviewer.
      input: prompt.replace(/\0/g, ""),
      encoding: "utf8",
      cwd,
      timeout: timeoutMs,
      maxBuffer,
      env: { ...process.env, [CHILD_FLAG]: "1" },
      windowsHide: true,
      shell,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  // spawnSync marks a timeout by killing the child (status null, signal set);
  // flag it so batch callers can split/retry rather than record a dead batch.
  if (run.error) {
    const timedOut = run.error.code === "ETIMEDOUT" || (run.status === null && run.signal != null);
    return { ok: false, error: run.error.message, timedOut };
  }
  if (run.status !== 0 || !run.stdout) {
    return { ok: false, error: run.stderr?.trim() || `exit ${run.status}` };
  }
  try {
    const wrapper = JSON.parse(run.stdout);
    if (wrapper.is_error) return { ok: false, error: String(wrapper.result || "reviewer errored") };
    const text = typeof wrapper.result === "string" ? wrapper.result : run.stdout;
    const m = text.match(/\{[\s\S]*\}/);
    const violations = m ? JSON.parse(m[0]).violations : [];
    return { ok: true, violations: Array.isArray(violations) ? violations : [] };
  } catch (e) {
    return { ok: false, error: `unparseable reviewer output: ${e.message}` };
  }
}
