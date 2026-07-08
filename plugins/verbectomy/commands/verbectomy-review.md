---
description: Review comment quality on demand: the working diff, a branch, a commit, named files, or the whole repo.
argument-hint: "[--base <ref> | --commit <sha> | --repo | <file>...]"
allowed-tools: Bash(node *)
---

Reviewer output for `$ARGUMENTS`. Scopes: empty = the working diff; `--base <ref>` (alias `--branch`)
= the comments this branch added since it forked from `<ref>`, including uncommitted work; `--commit <sha>`
= the comments one commit introduced; file paths = those files reviewed whole; `--repo` = every source
file matching the configured globs. Tuning: `--model <name>`, `--max-batch <chars>`, `--timeout <ms>`.

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/review-cli.mjs" $ARGUMENTS`

Relay the findings above to the user, grouped by file. Each violation line reads
`file:line [rule, fix] why` with the offending comment beneath it. Name the fix the reviewer
assigned: `shrink` rewrites smaller while keeping the insight, `delete` removes the comment. Do not
edit files unless the user asks; if they do, apply only the listed fixes. If the summary line starts
with `INCOMPLETE`, some files were not reviewed; lead with that and name them, and never present it as clean.
