# verbectomy

> Elective surgery for over-commented code.

AI coding agents comment too much. They restate what the code already says, narrate their own
edits, and leave changelog notes that git already tracks. Telling the model to stop in `CLAUDE.md`
does not hold: the habit reasserts itself a few turns later.

Verbectomy makes it stick. It watches each turn, catches the noisy comments before they settle
into your codebase, and hands them back to the model to rewrite them properly or to delete them.

## What you get

- **A comment contract, injected every turn.** The rules stay in front of the model as it writes.
  That sets the standard for what is acceptable and tries to keep the model from slipping back into verbose habits.
- **A reviewer that enforces them.** At the end of a turn a cheap model reads the diff and, if it
  finds verbose or redundant comments, sends them back to be rewritten.
- **Cleaner commit messages.** A `git commit` with a padded or narration-heavy message is caught
  before it lands.

The reviewer runs in the background and never holds up a turn: every hook returns in about 100ms.
The review starts the moment the agent edits a file, not when it stops, so on any turn where the
agent keeps working after its last edit the verdict is ready before it finishes, and the violations
are handed back mid-turn at its next tool call. The agent fixes them in the same turn.

When a turn ends too fast for that (a single edit, then done), the verdict lands after the stop.
It is then delivered on your next prompt, and until it is resolved the stop hook and `git commit`
are both blocked on it, so nothing verbose slips through either way. Set `stopWaitMs` if you would
rather wait at the end of a turn than pick it up on the next one.

Good comments stay and can be enforced.

## Install

```
/plugin marketplace add DotHyphon/verbectomy
/plugin install verbectomy@verbectomy
```

Needs Node.js and the `claude` CLI on your `PATH`. Works on Windows, macOS, and Linux.

## Configure

Runs out of the box; no config needed. To override, put a `verbectomy.config.json` at `~/.claude/`
(all projects) or `<repo>/.claude/` (one project). Project wins over user, user over defaults. Set
only the keys you want to change. Arrays replace rather than merge.

| Key | Default | Meaning |
| --- | --- | --- |
| `injectContract` | `true` | Keep the contract in context each turn. Off still enforces; saves context. |
| `asyncReview` | `true` | Review in the background. `false` blocks the end of every turn until the review finishes. |
| `earlyReview` | `true` | Start the review at the first edit, so the verdict can be applied mid-turn. `false` waits for the stop. |
| `stopWaitMs` | `0` | Wait up to this long at the end of a turn for a review already running, to enforce it in the same turn. `0` never waits. |
| `reviewCommits` | `true` | Review git commit messages before they land. |
| `model` | `"haiku"` | Reviewer model. |
| `maxAttempts` | `3` | Rewrite rounds per turn before the stop is allowed through. |
| `maxDiffChars` | `0` | `0` never skips. Above it, a turn whose diff exceeds the limit skips auto-review and tells you to run it manually. |
| `requireDoc` | `false` | Flag public funcs/classes/interfaces missing a doc-comment. |
| `languages` | `[]` | Doc-style hint, e.g. `["Kotlin"]`. Empty detects from marker files. |
| `sourceGlobs` | `["*.ts", "*.py", "*.go", ...]` | Files reviewed. |
| `excludeGlobs` | `["**/test/**", "**/dist/**", ...]` | Files skipped. |

Example: Require doc-comments and only review TypeScript files:

```json
{ "requireDoc": true, "sourceGlobs": ["*.ts", "*.tsx"] }
```

To add your own comment rules, drop a `verbectomy.comment-rules.md` at `~/.claude/` (all projects) or
`<repo>/.claude/` (one project); it is appended to the contract. To switch verbectomy off, run
`/plugin disable verbectomy@verbectomy`.

## Review on demand

The turn-by-turn reviewer only looks at what changed. To review code that is already committed,
run `/verbectomy-review`:

```
/verbectomy-review                    # the current working diff
/verbectomy-review --base main        # comments this branch added since main, plus uncommitted work
/verbectomy-review --commit <sha>     # comments one commit introduced
/verbectomy-review src/a.ts src/b.go  # just these files, whole-file
/verbectomy-review --repo             # every source file matching your globs
```

`--branch` is an alias of `--base`. Tuning flags: `--model <name>`, `--max-batch <chars>`,
`--timeout <ms>` (per reviewer call).

It reports violations without editing; apply the fixes it lists, or ask the agent to. A large scope
is split into batches so each reviewer call stays within context; a batch that times out is halved
and retried, and any file that still cannot be reviewed is reported as `INCOMPLETE` rather than
counted clean.

## Did it run?

A clean review is silent. Every run still appends one line to `verbectomy.log` in your system temp
dir (`$env:TEMP` on Windows, `/tmp` elsewhere), so you can always see what it decided:

```
edit  [fb48875c] queued: 1 file(s) to background reviewer pid 25284 (118ms)
worker[fb48875c] found: 2 violation(s) [restate, narration] in src/api.ts (8801ms)
edit  [fb48875c] delivered 2 violation(s) mid-turn (93ms)
stop  [fb48875c] skip: nothing new since baseline/last pass (146ms)
```

`edit` lines are the post-edit hook that starts the review and hands back its verdict, `worker` the
background reviewer, `stop` the hook that ends your turn. A `skip: ... no comment syntax` line means
the diff could not contain a comment violation, so no model was called at all. Above, the agent was
told mid-turn and fixed the comments before stopping; had it not, the `stop` line would read
`block: 2 violation(s) from background review, attempt 1/3`.

## Development

```
npm test        # unit tests (no network, no claude CLI)
npm run eval    # run the labelled comment corpus through the reviewer
```

`npm run eval` calls the `claude` CLI, so it needs Node and an authenticated CLI on your `PATH`;
it calibrates `comment-rules.md` and is not wired into the plugin at runtime.

## License

MIT
