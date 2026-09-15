# Code Comment Contract

The correct number of comments in most diffs is zero. Every comment must buy its place with
information the code cannot show, at the smallest size that carries it. One short sentence is
the norm. Two lines is the ceiling. Model authors over-comment by default; treat every comment
as guilty until it proves otherwise.

## Hard rules

Flag every instance. These are mechanical, not judgment calls.

1. **Restating the code.** `// increment the counter` over `counter++`, `// loop over items`,
   `// return the result`, `// constructor`, `// call the service`. If deleting the comment
   loses nothing, deleting is the fix. This targets inline comments on executable statements. A
   doc-comment's one-line summary is governed by rule 4, not this rule: a function/method/class
   summary that names its behavior or what it returns complies even though it echoes the name. A
   doc summary restates only when it adds nothing beyond the identifier and type: a function whose
   summary is pure tautology (`// Read reads.`), or a field/property/constant whose name and type
   already say what it is and whose summary only re-says that in prose (`/// The text color of the
   label.` over `textColor: UIColor`; `Gets or sets X` on an auto-property named `X`), unless the
   summary adds a constraint or edge case.

2. **Section labels.** `// Arrange`, `// Act`, `// Assert`, `// Setup`, `// Given/When/Then`,
   `// Helpers`, `// Validation`, `// imports`, region markers. Code structure is visible;
   labels narrate it.

3. **Oversized comments.** Two lines is the ceiling for an inline (non-doc) comment, not the
   target. Any inline comment longer than 2 lines is a violation unless it states an invariant that
   genuinely cannot be shorter. A comment that is a paragraph is a design document in the wrong
   place. "Explains why" does NOT excuse length: a why that fits in one sentence and takes three is
   a violation. But a comment at or under two lines that carries a real why, constraint, invariant,
   or gotcha is at the ceiling and complies: do not flag it as oversized for a connective word
   ("Note that", "NOTE:", "and thus"). Reserve this rule for inline comments longer than two lines,
   rationale paragraphs, and padded multi-sentence blocks. Doc-comments are sized by rule 4, not by
   this ceiling: a one-line summary plus tags that each add non-obvious information is correctly
   sized whatever its total line count.

4. **Doc-comment padding.** A doc-comment is: one summary line stating what the caller gets,
   then ONLY the tags a caller cannot infer.
   - In a typed language, `@param`/`@return`/`@returns` restating the name and type is a
     violation: `@return the first tag` over `fun firstTag(): String?` says nothing
     the signature doesn't. But a tag that adds a non-obvious detail earns its line: the
     null/empty/error case, units, a range, a fallback, an ordering, the meaning of a cryptic name.
     `@return the image, or null if none is found` documents the null case and complies. When a
     tag's description is genuine but thin, lean toward leaving it: the harm to guard against is
     nagging a real doc-comment, not a slightly wordy tag.
   - In untyped JavaScript, the `{type}` in a JSDoc tag supplies a type the language lacks, so it
     is not a restatement; flag a JSDoc tag only when its description adds nothing beyond the name.
   - `@throws` earns its line only for conditions a caller cannot guess.
   - Beyond the summary, a short note of non-obvious behavior, an edge or error case, or a
     constraint (an overflow special case, a null/empty return) is not padding and need not be a
     tag. Rationale/history paragraphs (why it was written, alternatives weighed) are violations.
     A summary that paraphrases the name with a synonym and names the object or return is not
     tautology (`Disposes of a value.` for `drop`). Judge the summary as a whole: it complies if
     any clause is substantive, even alongside a weaker aside; flag only when the entire summary
     restates the identifier.

5. **Decision and process narration.** "we decided to", "as discussed", "per review", "after
   the sync meeting", "originally we tried X", ticket/PR chatter, author notes, dates.
   Narrating the edit: "updated to", "refactored to", "now handles". Git records history;
   comments describe the present.

   Instructions to future maintainers are constraints, NOT narration: "keep in sync with the
   other doc pages", "this must load before the bundle", "add this header to every new page".
   Narration looks backward at how the code got here; a maintainer instruction looks forward
   at what must stay true. When true and short, it complies.

6. **Em dashes.** The em dash character (`—`) is a violation; use a period or a comma. A hyphen
   (`-`), including a spaced hyphen used as a separator, is not an em dash and is not flagged.

7. **Commented-out code.** Delete it.

8. **Cryptic shorthand.** Terse must still be clear. A comment the reader must decode fails
   the same as one they must wade through.

9. **Comment removal.** Deleting a comment this contract bans (restatement, section label,
   narration, rationale, padding) is the fix, never a violation: judge deleted text as if it were
   added, and if adding it back would violate the contract, removing it was correct. A doc-comment
   counts as removed only when a public declaration keeps its code but loses its doc entirely, or a
   real constraint/invariant/gotcha the code cannot show is deleted with no surviving line carrying
   it. Trimming a verbose doc-comment down to a compliant summary is this tool working, not a loss.

Genuine short `TODO`/`FIXME` for remaining work is fine.

## Calibration examples

Judge incoming diffs against these. The VERBOSE examples are real model output style and MUST
be flagged even though every sentence in them is technically true.

VIOLATION (oversized doc, rationale paragraph, tag restating signature):

```
/**
 * Gets the first tag from the request header, in the order supplied.
 *
 * A single-tag route cannot apply a whole tag list, so the first tag acts as the
 * primary. Returned without validation: an unknown tag yields empty results through
 * downstream filters rather than silently falling back to another tag.
 *
 * @return The first tag, or null if the header was not set.
 */
fun firstTag(): String? = tags()?.firstOrNull()
```

COMPLIANT (same insight, right size):

```
/** First header tag, unvalidated: an unknown tag must yield empty results, not fall back. */
fun firstTag(): String? = tags()?.firstOrNull()
```

VIOLATION (three lines for a one-sentence why):

```
// The locale set is order-independent, but formatting follows the primary locale.
// The same set with a different primary produces different output, so the key
// must carry it.
return primary?.let { "$locales|p$it" } ?: locales
```

COMPLIANT:

```
// Same locale set with a different primary formats differently; key must differ.
return primary?.let { "$locales|p$it" } ?: locales
```

VIOLATION (section labels):

```
// Arrange
val svc = Service()
// Act
val out = svc.run()
// Assert
assertEquals(1, out)
```

COMPLIANT: the same code with no comments.

COMPLIANT (constraint the code cannot show, one line):

```
// The vendor gateway closes idle sockets after 30s, so re-open per batch rather than pooling.
const conn = openConnection();
```

COMPLIANT (keep-in-sync constraint; the code cannot show that other files mirror this block
or that its position matters):

```
<!-- Everything above loads the shared top bar; every static doc page needs this block, keep in sync. -->
<div class="content">
```

A constraint comment like these can be flagged as oversized when bloated, never for existing.
Do not call a true constraint "restatement" because the code it protects sits next to it.

COMPLIANT (one-line doc summary; naming the declaration is the convention, not restatement):

```
// Join concatenates the elements of a slice into a single string separated by sep.
func Join(elems []string, sep string) string { ... }

/// Returns the number of bytes the encoded value occupies.
pub fn encoded_len(&self) -> usize { ... }
```

VIOLATION (doc summary adding nothing beyond the identifier and type: a tautological function
summary, or a field/property whose name and type already say what it is):

```
// Read reads.
func Read(p []byte) (n int, err error) { ... }

/// The text color of the label.
var textColor: UIColor

/// <summary>Gets or sets the name.</summary>
public string Name { get; set; }
```

## Verdicts: delete vs shrink

Every violation carries the right fix. Restatement, section labels, narration, and
commented-out code: delete. Oversized comments and doc padding that wrap a real insight:
shrink to it, never delete it. If the user has explicitly asked for a comment to stay, it
stays; the reviewer's job is size and quality, not overriding the author's judgment that a
constraint is worth recording.

## Required documentation (project-gated)

When the project config enables `requireDoc`:

- Public functions, classes, and interfaces MUST carry a doc-comment: one summary line, plus
  only non-obvious tags, sized per hard rule 4.
- Use the project's native doc style (TSDoc/JSDoc, KDoc, Javadoc, docstrings, godoc,
  rustdoc `///`, XML docs). Never another language's convention.
- Exempt: `private`, `internal`, `override` members, test sources, generated code.

requireDoc requires presence, not bulk. A one-line doc satisfies it; an oversized doc still
violates rule 4.

## Markdown and prose files

For `.md` and other text/docs, the whole file is prose. Same spirit, applied to sentences:

- Cut filler and hedging: "basically", "simply", "just", "in order to", "it's worth noting
  that", "as you can see". Say the thing.
- One idea per sentence; no restating the previous sentence in new words.
- No decision/process narration. Document the result.
- No em dashes. Prefer short words (use "big" not "extensive", "fix" not "implement a solution
  for").
- Keep code blocks, commands, headings, tables, and links intact; do not "tighten" those.
- Preserve meaning and every concrete fact. Concision, not deletion of content.

## Git commit messages

- Subject line: imperative mood ("Add", not "Added"/"Adds"), no trailing period.
- No column or per-line character limit anywhere in the message; never flag subject or body line
  length. The whole message is what stays short: subject plus at most a few sentences of body,
  roughly 400 characters in total.
- A project-mandated subject structure (a ticket type and number, a scope prefix, the ticket title
  verbatim) is required content, not filler or process narration. Never flag it.
- Blank line, then a body ONLY when it adds the WHY the diff cannot show. Skip the body entirely
  for obvious changes.
- The body explains why, not a line-by-line restatement of the diff.
- No filler or hedging, no decision/process narration, no em dashes.
- Prefer prose; bullet points are discouraged and earn their place only when the body lists several
  genuinely independent points.
- Do not hard-wrap to a column; a paragraph is one line and the reader's tool soft-wraps it. Reserve
  line breaks for meaning: a blank line between distinct points.
