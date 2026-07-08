// Labelled corpus of real-world comment examples for the eval harness
// (run.mjs). Each case is a small, realistic snippet run through the shipping
// reviewer prompt; `expect` is the verdict the contract should produce.
//
//   expect: "flag" -> reviewer MUST return >=1 violation
//   expect: "pass" -> reviewer MUST return zero violations
//
// `file` sets the language (drives the doc-style hint). Provide `code` for an
// all-added new file, or `diff` for cases that need deletions/context lines.
// `rules` is the expected rule id(s) for a flag (informational only). `note`
// records the source and the reason. These are DATA strings, not live
// comments, so this file is not itself subject to review.
//
// Cases are deliberately balanced: obvious violations, obvious compliant
// comments, and the hard borderline cases in both directions (verbose-but-true
// that must still flag; terse constraints that must NOT flag). No example is
// tuned to a keyword; the contract must generalise.

export const CORPUS = [
  // ============================================================
  // Rule 1: restating the code  (expect flag / delete)
  // ============================================================
  {
    id: "js-restate-increment",
    file: "src/counter.js",
    expect: "flag",
    rules: ["restate"],
    note: "Classic redundant comment (Clean Code, ch.4 Noise Comments).",
    code: `
function tick(state) {
  // increment the counter
  state.count++;
  return state;
}`,
  },
  {
    id: "py-restate-return",
    file: "app/util.py",
    expect: "flag",
    rules: ["restate"],
    note: "Comment narrates the obvious return.",
    code: `
def total(items):
    # return the sum of the items
    return sum(items)`,
  },
  {
    id: "java-restate-constructor",
    file: "src/main/java/Point.java",
    expect: "flag",
    rules: ["restate"],
    note: "Clean Code 'Redundant Comments' example: constructor comment.",
    code: `
public class Point {
    private final int x;
    private final int y;

    // Constructor
    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }
}`,
  },
  {
    id: "cs-restate-setter",
    file: "src/Person.cs",
    expect: "flag",
    rules: ["restate"],
    note: "Setter comment restates the assignment.",
    code: `
public void SetName(string name)
{
    // set the name field to the given name
    this.name = name;
}`,
  },
  {
    id: "go-restate-loop",
    file: "cmd/sum.go",
    expect: "flag",
    rules: ["restate"],
    note: "Loop comment adds nothing over the code.",
    code: `
func sum(xs []int) int {
	total := 0
	// loop over all the numbers
	for _, x := range xs {
		total += x
	}
	return total
}`,
  },

  // ============================================================
  // Rule 2: section labels  (expect flag / delete)
  // ============================================================
  {
    id: "ts-section-aaa",
    file: "src/math.ts",
    expect: "flag",
    rules: ["section-label"],
    note: "Arrange/Act/Assert labels; structure is visible.",
    code: `
export function demo() {
  // Arrange
  const svc = new Service();
  // Act
  const out = svc.run();
  // Assert
  return out === 1;
}`,
  },
  {
    id: "py-section-setup",
    file: "app/pipeline.py",
    expect: "flag",
    rules: ["section-label"],
    note: "'# Setup' / '# Helpers' region labels.",
    code: `
def build():
    # Setup
    cfg = load_config()
    engine = create_engine(cfg)
    # Helpers
    def normalize(x):
        return x.strip().lower()
    return engine, normalize`,
  },
  {
    id: "js-section-imports",
    file: "src/index.js",
    expect: "flag",
    rules: ["section-label"],
    note: "'// imports' label over an import block.",
    code: `
// imports
import fs from "node:fs";
import path from "node:path";

export const root = path.dirname(fs.realpathSync("."));`,
  },

  // ============================================================
  // Rule 3: oversized / rationale paragraph  (expect flag / shrink)
  // ============================================================
  {
    id: "kt-oversized-why",
    file: "src/main/kotlin/Format.kt",
    expect: "flag",
    rules: ["oversized"],
    note: "Three lines for a one-sentence why (contract calibration example).",
    code: `
fun cacheKey(locales: String, primary: Long?): String {
    // The locale set is order-independent, but formatting follows the primary locale.
    // The same set with a different primary produces different output, so the key
    // must carry it.
    return primary?.let { "$locales|p$it" } ?: locales
}`,
  },
  {
    id: "ts-oversized-paragraph",
    file: "src/retry.ts",
    expect: "flag",
    rules: ["oversized"],
    note: "Paragraph block comment that a single sentence covers.",
    code: `
// We use exponential backoff here because the downstream service can get
// overwhelmed under load. When it is overwhelmed it returns 503s, and if we
// retried immediately we would just make the problem worse, so instead we wait
// progressively longer between each attempt to give it time to recover before
// we try again.
async function callWithRetry(fn) {
  return backoff(fn);
}`,
  },

  // ============================================================
  // Rule 4: doc-comment padding  (expect flag / shrink)
  // ============================================================
  {
    id: "java-javadoc-padding",
    file: "src/main/java/UserService.java",
    expect: "flag",
    rules: ["doc-padding"],
    note: "@param/@return restate name+type; nothing a caller can't infer.",
    code: `
/**
 * Gets the user by id.
 *
 * @param id the id of the user
 * @return the user with the given id
 */
public User getUser(long id) {
    return repo.findById(id);
}`,
  },
  {
    id: "ts-jsdoc-padding",
    file: "src/api.ts",
    expect: "flag",
    rules: ["doc-padding"],
    note: "JSDoc tags echo the signature exactly.",
    code: `
/**
 * Adds two numbers.
 * @param {number} a - the first number
 * @param {number} b - the second number
 * @returns {number} the sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}`,
  },
  {
    id: "py-docstring-padding",
    file: "app/geometry.py",
    expect: "flag",
    rules: ["doc-padding", "oversized"],
    note: "Docstring restates args/returns with no added info.",
    code: `
def area(width, height):
    """Compute the area.

    Args:
        width: the width.
        height: the height.

    Returns:
        The area (width times height).
    """
    return width * height`,
  },

  // ============================================================
  // Rule 5: decision / process / changelog narration  (expect flag / delete)
  // ============================================================
  {
    id: "js-narration-changelog",
    file: "src/session.js",
    expect: "flag",
    rules: ["narration"],
    note: "Changelog chatter in a comment; git records this.",
    code: `
// 2024-03-11: refactored by Alex after the sync meeting, we decided to
// switch from sessions to JWTs per the review.
export function makeToken(user) {
  return sign(user);
}`,
  },
  {
    id: "cs-narration-updated",
    file: "src/Report.cs",
    expect: "flag",
    rules: ["narration"],
    note: "'Updated to now handle...' narrates the edit.",
    code: `
// Updated this method to now also handle the null case after the bug report.
public string Format(Report r)
{
    return r?.Title ?? "(untitled)";
}`,
  },
  {
    id: "js-narration-usedto",
    file: "src/cache2.js",
    expect: "flag",
    rules: ["narration"],
    note: "Explicit changelog: names the abandoned prior implementation.",
    code: `
function load(key) {
  // We used to truncate oversized entries here; now we skip them.
  return store.get(key);
}`,
  },
  {
    id: "js-narration-rather-than",
    file: "src/review2.js",
    expect: "flag",
    rules: ["narration"],
    note: "Implicit changelog: 'rather than X' where X is the abandoned prior behavior, and the reason already stands without it.",
    code: `
function review(diff) {
  // Skip oversized diffs, rather than truncating them as before.
  if (diff.length > LIMIT) return skip();
  return run(diff);
}`,
  },
  {
    id: "js-constraint-rather-than",
    file: "src/net2.js",
    expect: "pass",
    note: "Compliant 'rather than X': warns against a wrong alternative and says why (forward constraint, contract's vendor-gateway shape).",
    code: `
// The gateway drops idle sockets after 30s, so re-open per batch rather than pooling.
const conn = openConnection();`,
  },

  // ============================================================
  // Rule 7: commented-out code  (expect flag / delete)
  // ============================================================
  {
    id: "py-commented-out",
    file: "app/handler.py",
    expect: "flag",
    rules: ["commented-out"],
    note: "Dead code left commented out.",
    code: `
def handle(req):
    result = process(req)
    # result = legacy_process(req)
    # log.debug(result)
    return result`,
  },
  {
    id: "go-commented-out",
    file: "server/main.go",
    expect: "flag",
    rules: ["commented-out"],
    note: "Commented-out call block.",
    code: `
func start() {
	srv := newServer()
	// srv.EnableTLS()
	// srv.SetTimeout(30)
	srv.Listen(":8080")
}`,
  },

  // ============================================================
  // Rule 8: cryptic shorthand  (expect flag)
  // ============================================================
  {
    id: "js-emdash-real",
    file: "src/cache.js",
    expect: "flag",
    rules: ["em-dash"],
    note: "Genuine em dash character in a comment; rule 6 should fire.",
    code: `
// Cache is write-through — every put also hits the backing store synchronously.
const cache = new Map();`,
  },
  {
    id: "c-cryptic",
    file: "src/dsp.c",
    expect: "flag",
    rules: ["cryptic"],
    note: "Terse to the point of meaningless.",
    code: `
void step(state_t *s) {
    /* fix hp wrap */
    s->hp = (s->hp + 1) & MASK;
}`,
  },

  // ============================================================
  // COMPLIANT: short why / constraint / gotcha  (expect pass)
  // These are the false-positive traps: a lenient rewrite would flag them.
  // ============================================================
  {
    id: "js-why-oneliner",
    file: "src/net.js",
    expect: "pass",
    note: "One-line constraint the code cannot show (contract compliant example).",
    code: `
// The vendor gateway closes idle sockets after 30s, so re-open per batch rather than pooling.
const conn = openConnection();`,
  },
  {
    id: "kt-constraint-oneliner",
    file: "src/main/kotlin/Cache.kt",
    expect: "pass",
    note: "Compliant shrunk why (contract COMPLIANT calibration example).",
    code: `
fun cacheKey(locales: String, primary: Long?): String {
    // Same locale set with a different primary formats differently; key must differ.
    return primary?.let { "$locales|p$it" } ?: locales
}`,
  },
  {
    id: "go-workaround-why",
    file: "net/http/transport.go",
    expect: "pass",
    note: "Real Go stdlib style: short why for a non-obvious guard.",
    code: `
func (t *Transport) tryClose(c *conn) {
	// Close the connection eagerly; some servers leak fds if we wait for GC.
	c.close()
}`,
  },
  {
    id: "py-gotcha-float",
    file: "app/money.py",
    expect: "pass",
    note: "Warns of a real gotcha the code cannot show.",
    code: `
def to_cents(amount):
    # Round before int(): float noise makes 1.15*100 == 114.99999 otherwise.
    return int(round(amount * 100))`,
  },
  {
    id: "ts-invariant",
    file: "src/ring.ts",
    expect: "pass",
    note: "States an invariant callers rely on.",
    code: `
export function push(buf: Buffer, x: number) {
  // capacity is always a power of two, so & wraps without a branch.
  buf.data[buf.head++ & (buf.cap - 1)] = x;
}`,
  },
  {
    id: "sql-why",
    file: "migrations/002_index.sql",
    expect: "pass",
    note: "Explains a non-obvious index choice.",
    code: `
-- Partial index: 99% of rows are archived and never queried by status.
CREATE INDEX idx_open_orders ON orders (status) WHERE status <> 'archived';`,
  },
  {
    id: "sh-gotcha",
    file: "scripts/deploy.sh",
    expect: "pass",
    note: "Real shell gotcha worth recording.",
    code: `
# rsync needs the trailing slash or it nests the dir inside itself.
rsync -a build/ "$TARGET/"`,
  },
  {
    id: "rs-why-unsafe",
    file: "src/buf.rs",
    expect: "pass",
    note: "Justifies an unsafe block; a real invariant.",
    code: `
pub fn first(&self) -> &u8 {
    // Safe: constructor rejects empty slices, so index 0 always exists.
    unsafe { self.data.get_unchecked(0) }
}`,
  },
  {
    id: "todo-legit",
    file: "src/parser.js",
    expect: "pass",
    note: "Genuine short TODO for remaining work is allowed.",
    code: `
function parse(src) {
  // TODO: handle escaped delimiters
  return src.split(",");
}`,
  },

  // ============================================================
  // COMPLIANT: minimal doc-comments  (expect pass)
  // ============================================================
  {
    id: "go-doc-oneline",
    file: "strings/join.go",
    expect: "pass",
    note: "godoc convention: one line starting with the name.",
    code: `
// Join concatenates the elements of its first argument to create a single string.
func Join(elems []string, sep string) string {
	return strings.Join(elems, sep)
}`,
  },
  {
    id: "rs-doc-oneline",
    file: "src/lib.rs",
    expect: "pass",
    note: "rustdoc one-line summary, no redundant tags.",
    code: `
/// Returns the number of bytes the encoded value occupies.
pub fn encoded_len(&self) -> usize {
    self.len
}`,
  },
  {
    id: "ts-doc-oneline",
    file: "src/tag.ts",
    expect: "pass",
    note: "Tight one-line TSDoc summary, no echo tags.",
    code: `
/** First header tag, unvalidated: an unknown tag must yield empty results. */
export function firstTag(): string | null {
  return tags()?.[0] ?? null;
}`,
  },

  // ============================================================
  // COMPLIANT: keep-in-sync / ordering constraints  (expect pass)
  // ============================================================
  {
    id: "html-keepinsync",
    file: "docs/page.html",
    expect: "pass",
    note: "Keep-in-sync constraint the code cannot show (contract example).",
    code: `
<!-- Everything above loads the shared top bar; every static doc page needs this block, keep in sync. -->
<div class="content">
  <p>Body</p>
</div>`,
  },
  {
    id: "yaml-ordering",
    file: "deploy/order.yaml",
    expect: "pass",
    note: "Ordering constraint that matters and is invisible in code.",
    code: `
# migrations must run before the app container starts, or the schema check fails.
depends_on:
  - migrate`,
  },

  // ============================================================
  // Markdown / prose  (both directions)
  // ============================================================
  {
    id: "md-filler-flag",
    file: "docs/guide.md",
    expect: "flag",
    rules: ["prose-filler"],
    note: "Filler/hedging prose the md rules target.",
    code: `
## Setup

Basically, in order to get started, it's worth noting that you simply need to
just run the install command, and as you can see it will handle everything for you.`,
  },
  {
    id: "md-clean-pass",
    file: "docs/install.md",
    expect: "pass",
    note: "Tight prose with a real command; must not be over-tightened.",
    code: `
## Install

Run the installer, then restart the shell so the new PATH entry takes effect:

\`\`\`
npm install -g verbectomy
\`\`\``,
  },

  // ============================================================
  // Deletion cases (doc-removed) via raw diff  (both directions)
  // ============================================================
  {
    id: "doc-removed-flag",
    file: "src/api/client.ts",
    expect: "flag",
    rules: ["doc-removed"],
    note: "Public declaration keeps its code but loses its doc-comment.",
    diff: `--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -1,6 +1,3 @@
-/** Opens a pooled connection; caller must release() it or the pool starves. */
-export function acquire(): Conn {
+export function acquire(): Conn {
   return pool.take();
 }`,
  },
  {
    id: "delete-restatement-pass",
    file: "src/loop.js",
    expect: "pass",
    note: "Deleting a banned restatement comment is the fix, not a violation.",
    diff: `--- a/src/loop.js
+++ b/src/loop.js
@@ -1,4 +1,3 @@
 function run(items) {
-  // loop over the items
   for (const it of items) process(it);
 }`,
  },

  // ============================================================
  // VERBOSE-BUT-TRUE doc: the hardest flag case (contract's headline example)
  // ============================================================
  {
    id: "kt-verbose-doc-flag",
    file: "src/main/kotlin/Header.kt",
    expect: "flag",
    rules: ["oversized", "doc-padding"],
    note: "Contract's headline VIOLATION: true, well-written, still oversized.",
    code: `
/**
 * Gets the first tag from the request header, in the order supplied.
 *
 * A single-tag route cannot apply a whole tag list, so the first tag acts as the
 * primary. Returned without validation: an unknown tag yields empty results through
 * downstream filters rather than silently falling back to another tag.
 *
 * @return The first tag, or null if the header was not set.
 */
fun firstTag(): String? = tags()?.firstOrNull()`,
  },

  // ============================================================
  // Doc-comment conventions across styles. GOOD = minimal summary + only
  // non-obvious tags (expect pass); BAD = redundant tags / rationale (flag).
  // Sourced from each language's official style guide (TSDoc, JSDoc, PEP 257,
  // godoc, rustdoc, Javadoc, KDoc, C# XML docs).
  // ============================================================
  {
    id: "tsdoc-thin-tags",
    file: "src/greet.ts",
    expect: "flag",
    rules: ["doc-padding"],
    note: "Stricter than tsdoc.org: in TS the type is in the signature, so '@returns A greeting string' restates it and '@param name - The name...' just restates the name.",
    code: `
/**
 * Greets a user by name.
 *
 * @param name - The name of the user to greet
 * @returns A greeting string
 */
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`,
  },
  {
    id: "tsdoc-bad",
    file: "src/add.ts",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "Summary parrots name; tags restate signature; @remarks holds ticket rationale.",
    code: `
/**
 * This is a function called add. It adds two numbers.
 *
 * @remarks
 * I chose to write this as a static-style helper because in the original
 * ticket we discussed whether to inline the addition at the call sites, but
 * we decided a named function reads better and is easier to unit test later.
 *
 * @param a - a of type number
 * @param b - b of type number
 * @returns a number
 */
function add(a: number, b: number): number {
  return a + b;
}`,
  },
  {
    id: "jsdoc-redundant-desc",
    file: "src/add.js",
    expect: "flag",
    rules: ["doc-padding"],
    note: "Untyped-JS {type} is load-bearing, but the descriptions purely echo the parameter names and restate the return type.",
    code: `
/**
 * Adds two numbers together.
 * @param {number} a - the number a
 * @param {number} b - the number b
 * @returns {number} a number
 */
function add(a, b) { return a + b; }`,
  },
  {
    id: "jsdoc-info-tags",
    file: "src/average.js",
    expect: "pass",
    note: "Untyped-JS JSDoc where {type} is load-bearing and descriptions add real info (non-empty precondition, NaN case).",
    code: `
/**
 * Arithmetic mean of a list of numbers.
 * @param {number[]} xs - must be non-empty
 * @returns {number} the mean, or NaN if xs is empty
 */
function average(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }`,
  },
  {
    id: "jsdoc-bad",
    file: "src/empty.js",
    expect: "flag",
    rules: ["doc-padding", "oversized"],
    note: "Filler summary; @param str - str and @returns restate nothing.",
    code: `
/**
 * The isEmpty function.
 *
 * This function is a very useful and important utility function that you can
 * use whenever you need to check whether or not a given input string value
 * is empty or not empty.
 *
 * @param {string} str - str
 * @returns {boolean} returns true or false
 */
function isEmpty(str) { return str.length === 0; }`,
  },
  {
    id: "pydoc-good",
    file: "app/paths.py",
    expect: "pass",
    note: "PEP 257 one-liner for an obvious function.",
    code: `
def kos_root():
    """Return the pathname of the KOS root directory."""
    return _root`,
  },
  {
    id: "pydoc-bad",
    file: "app/cake.py",
    expect: "flag",
    rules: ["doc-padding", "narration", "oversized"],
    note: "Body narrates refactor history; Args/Returns restate types.",
    code: `
def calculate_slices_needed(people_coming: int, slices_per_person: int) -> int:
    """Calculate the total number of cake slices needed for all people.

    This function calculates the total number of slices needed. It does this
    by multiplying the two numbers together. I originally wrote it with a loop
    but then refactored it to a multiplication because that is faster.

    Args:
        people_coming (int): The people_coming, an int.
        slices_per_person (int): The slices_per_person, an int.

    Returns:
        int: An int that is the return value.
    """
    return people_coming * slices_per_person`,
  },
  {
    id: "godoc-behavior-detail",
    file: "strconv/quote.go",
    expect: "pass",
    note: "go.dev/doc/comment: summary + non-obvious behavior detail (escape sequences); behavior notes are not padding.",
    code: `
// Quote returns a double-quoted Go string literal representing s.
// The returned string uses Go escape sequences (\\t, \\n, \\xFF, \\u0100)
// for control characters and non-printable characters.
func Quote(s string) string {
	return strconv.Quote(s)
}`,
  },
  {
    id: "godoc-bad",
    file: "strconv/quote2.go",
    expect: "flag",
    rules: ["narration", "restate"],
    note: "'This is a function' contentless; paragraph is v2-refactor changelog.",
    code: `
// This is a function.
//
// It takes a string s and returns a string. We use this function in a lot of
// places across the codebase, and it was added in the v2 refactor after the
// team debated whether to use strconv directly instead.
func Quote(s string) string {
	return strconv.Quote(s)
}`,
  },
  {
    id: "rustdoc-good",
    file: "src/vec.rs",
    expect: "pass",
    note: "Rust API guidelines: one-line third-person summary.",
    code: `
/// Returns the number of elements in the vector, also referred to as its 'length'.
pub fn len(&self) -> usize {
    self.len
}`,
  },
  {
    id: "rustdoc-bad",
    file: "src/vec2.rs",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "Documents self, restates return type, embeds a benchmark rationale.",
    code: `
/// Get length.
///
/// # Arguments
///
/// * \`self\` - the self parameter, which is the vector itself
///
/// # Returns
///
/// A usize which is the length. Note: I benchmarked this and it is O(1)
/// because we store the length inline, which is why I did not use a loop.
pub fn len(&self) -> usize {
    self.len
}`,
  },
  {
    id: "javadoc-good",
    file: "src/main/java/Applet.java",
    expect: "pass",
    note: "Oracle Javadoc guide: summary + tags that add meaning (null case).",
    code: `
/**
 * Returns an Image object that can then be painted on the screen.
 *
 * @param name the location of the image, relative to the url argument
 * @return the image at the specified URL, or null if none is found
 */
public Image getImage(String name) {
    return cache.get(name);
}`,
  },
  {
    id: "javadoc-bad",
    file: "src/main/java/Applet2.java",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "Summary restates name; tags echo name+type; @implNote is ticket history.",
    code: `
/**
 * This method is a getter method called getImage that gets the image.
 *
 * @param name the name (a String)
 * @return returns an Image
 * @implNote We used to cache these but removed the cache in JIRA-1234
 *           because it caused a memory leak on the staging boxes.
 */
public Image getImage(String name) {
    return load(name);
}`,
  },
  {
    id: "kdoc-good",
    file: "src/main/kotlin/Math.kt",
    expect: "pass",
    note: "Kotlin docs: summary + a non-obvious overflow special case.",
    code: `
/**
 * Returns the absolute value of the given [number].
 *
 * Special cases: for \`Int.MIN_VALUE\` the result is \`Int.MIN_VALUE\` itself due to overflow.
 */
fun abs(number: Int): Int {
    return if (number < 0) -number else number
}`,
  },
  {
    id: "kdoc-bad",
    file: "src/main/kotlin/Geometry.kt",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "Placement rationale paragraph; @param/@return restate name+type.",
    code: `
/**
 * Calculates the area of a rectangle. This is the calculateArea function.
 *
 * I put this in the geometry utils file rather than on the Rectangle class
 * because we might reuse it elsewhere, though we haven't yet.
 *
 * @param width width, an Int
 * @param height height, an Int
 * @return an Int (the area)
 */
fun calculateArea(width: Int, height: Int): Int {
    return width * height
}`,
  },
  {
    id: "csharpdoc-thin-tags",
    file: "src/Sequence.cs",
    expect: "flag",
    rules: ["doc-padding"],
    note: "A good summary does not rescue tags that purely echo the name and restate the return type.",
    code: `
/// <summary>Returns a subset of the sequence, skipping the first <paramref name="count"/> items.</summary>
/// <param name="count">the count</param>
/// <returns>an IEnumerable of T</returns>
public IEnumerable<T> SkipItems(int count) => _items.Skip(count);`,
  },
  {
    id: "csharpdoc-bad",
    file: "src/Sequence2.cs",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "Summary restates name + design-review rationale; tags echo signature.",
    code: `
/// <summary>
/// This is the SkipItems method. It is a public method that skips items.
/// I made count an int rather than uint to match the rest of the API surface,
/// see the design review notes from last sprint for the full discussion.
/// </summary>
/// <param name="count">count</param>
/// <returns>Returns an IEnumerable of T.</returns>
public IEnumerable<T> SkipItems(int count) => _items.Skip(count);`,
  },

  // ============================================================
  // REAL violations harvested from style guides / blogs (expect flag).
  // Source URL recorded in each note.
  // ============================================================
  {
    id: "js-donttouch-cryptic",
    file: "src/config.js",
    expect: "flag",
    rules: ["cryptic"],
    note: "plainenglish.io funny-comments: warns without explaining.",
    code: `
const timeout = 250; // Magic. Do not touch.`,
  },
  {
    id: "js-changelog-block",
    file: "src/Chart.js",
    expect: "flag",
    rules: ["narration"],
    note: "Uncle Bob Clean Code: hand-maintained changelog in a comment.",
    code: `
/**
 * Changes (from 11-Oct-2001)
 * --------------------------
 * 11-Oct-2001 : Re-organised the class and moved it to new package (DG);
 * 05-Nov-2001 : Added a getDescription() method (DG);
 */
export class Chart {}`,
  },
  {
    id: "js-thought-narration",
    file: "src/solver.js",
    expect: "flag",
    rules: ["narration"],
    note: "bytedev anti-patterns: author's uncertain thought process.",
    code: `
// I think this is faster than the previous implementation.
// Not sure, still have to test. Waiting for the QA to come back from leave.
function solve(x) { return fast(x); }`,
  },
  {
    id: "js-position-marker",
    file: "src/widget.js",
    expect: "flag",
    rules: ["section-label"],
    note: "Uncle Bob Clean Code: position-marker banner.",
    code: `
// ------------------------------ Instance Variables
let cache = {};
let count = 0;`,
  },
  {
    id: "js-end-brace-label",
    file: "src/report.js",
    expect: "flag",
    rules: ["section-label"],
    note: "bytedev: closing-brace scope markers.",
    code: `
function report(customers) {
  if (customers.length) {
    for (const customer of customers) {
      send(customer);
    } // end foreach
  } // end if
}`,
  },
  {
    id: "ts-jsdoc-repeat-sig",
    file: "src/color.ts",
    expect: "flag",
    rules: ["doc-padding", "oversized"],
    note: "effectivetypescript.com: JSDoc restates the ?: string signature.",
    code: `
/**
 * Returns a string with the foreground color.
 * Takes zero or one arguments. With no arguments, returns the
 * standard foreground color. With one argument, returns the foreground
 * color for a particular page.
 */
function getForegroundColor(page?: string) {
  return page ? colors[page] : colors.default;
}`,
  },
  {
    id: "py-docstring-restate-body",
    file: "app/users.py",
    expect: "flag",
    rules: ["doc-padding"],
    note: "pycoderhub PEP 257: docstring restates the one-line body.",
    code: `
def get_username(user_id):
    """This function gets the username by accessing the user_database dictionary."""
    return user_database[user_id].username`,
  },
  {
    id: "py-docstring-signature",
    file: "app/answer.py",
    expect: "flag",
    rules: ["doc-padding"],
    note: "rdegges: PEP 257 forbids restating the signature.",
    code: `
def stupid_function(a):
    """stupid_function(a) -> int"""
    return 4`,
  },
  {
    id: "java-param-cryptic-explained",
    file: "src/main/java/QuickEntryMediator.java",
    expect: "pass",
    note: "Cryptic single-letter params t/l whose @param descriptions explain their non-obvious roles; the description adds info the signature cannot.",
    code: `
/**
 * @param t The JTextField from which abbreviations will be gotten.
 * @param l The JList that will be automatically scrolled to match.
 */
public QuickEntryMediator(JTextField t, JList l) {
    this.textField = t;
    this.list = l;
}`,
  },
  {
    id: "cs-getset-autoprop",
    file: "src/Customer.cs",
    expect: "flag",
    rules: ["restate"],
    note: "MS XML docs anti-pattern: 'Gets or sets the Name' on auto-property.",
    code: `
/// <summary>
/// Gets or sets the name.
/// </summary>
public string Name { get; set; }`,
  },
  {
    id: "cs-summary-is-name",
    file: "src/Model.cs",
    expect: "flag",
    rules: ["restate"],
    note: "davidwhitney 'XML Comment Hell': summary is literally the property name.",
    code: `
/// <summary>
/// Description
/// </summary>
public string Description { get; set; }`,
  },
  {
    id: "go-tutorial-restate",
    file: "cmd/guess.go",
    expect: "flag",
    rules: ["restate"],
    note: "DigitalOcean Go tutorial: comments state what the code makes obvious.",
    code: `
func main() {
	// Create an input loop
	for {
		// Ask the user to guess my favorite color
		fmt.Println("Guess my favorite color:")
		break
	}
}`,
  },
  {
    id: "go-read-reads",
    file: "io/reader.go",
    expect: "flag",
    rules: ["restate", "doc-padding"],
    note: "Google Go style: 'Read reads.' is a redundant-name placeholder.",
    code: `
// Read reads.
func Read(p []byte) (n int, err error) {
	return 0, nil
}`,
  },
  {
    id: "cpp-find-element",
    file: "src/search.cc",
    expect: "flag",
    rules: ["restate"],
    note: "Google C++ style: narrates the stdlib call.",
    code: `
void find(std::vector<int>& v, int element) {
  // Find the element in the vector.
  auto result = std::find(v.begin(), v.end(), element);
  (void)result;
}`,
  },
  {
    id: "cpp-core-nl1",
    file: "src/mix.cpp",
    expect: "flag",
    rules: ["restate"],
    note: "C++ Core Guidelines NL.1: repeats the operators.",
    code: `
auto combine(Matrix m, Vector v1, Vector vv) {
  auto x = m * v1 + vv;   // multiply m with v1 and add the result to vv
  return x;
}`,
  },
  {
    id: "swift-textcolor-restate",
    file: "src/Label.swift",
    expect: "flag",
    rules: ["restate", "doc-padding"],
    note: "vadimbulavin: doc restates name+type of the property.",
    code: `
/// The text color of the label.
var textColor: UIColor = .black`,
  },
  {
    id: "swift-file-header",
    file: "src/AppDelegate.swift",
    expect: "flag",
    rules: ["narration"],
    note: "vadimbulavin: author/date/copyright header git already tracks.",
    code: `
//
//  AppDelegate.swift
//  Article-SwiftComments
//  Created by Vadym Bulavin on 4/9/19.
//  Copyright © 2019 Vadym Bulavin. All rights reserved.
//
import UIKit`,
  },
  {
    id: "ruby-increment",
    file: "lib/counter.rb",
    expect: "flag",
    rules: ["restate"],
    note: "rubystyle.guide #no-comments: parrots i += 1.",
    code: `
def tick
  # increment counter
  i += 1
end`,
  },
  {
    id: "ruby-expires",
    file: "app/controllers/cache_controller.rb",
    expect: "flag",
    rules: ["restate"],
    note: "rubystyle.guide #no-comments: restates the readable call.",
    code: `
def show
  # expires in 60 minutes
  expires_in 60.minutes
end`,
  },
  {
    id: "php-errorhandler-doc",
    file: "src/ErrorHandler.php",
    expect: "flag",
    rules: ["doc-padding"],
    note: "Adobe PHP DocBlock: short description repeats the class name.",
    code: `
/**
 * Error Handler
 */
class ErrorHandler {}`,
  },
  {
    id: "php-return-int-doubled",
    file: "src/Result.php",
    expect: "flag",
    rules: ["doc-padding"],
    note: "hatchet.com.au: @return int duplicates the native : int return type.",
    code: `
/**
 * Get the number of rows.
 * @return int
 */
public function rowCount(): int { return $this->rowCount; }`,
  },
  {
    id: "sql-commented-out",
    file: "queries/report.sql",
    expect: "flag",
    rules: ["commented-out"],
    note: "datacamp: dead queries kept 'in case'.",
    code: `
/*SELECT * FROM Customers;
SELECT * FROM Products;*/
SELECT * FROM Categories;`,
  },
  {
    id: "sql-get-active",
    file: "queries/users.sql",
    expect: "flag",
    rules: ["restate"],
    note: "medium: narrates the SELECT in English (guide wrongly calls it good).",
    code: `
-- Get all active users
SELECT * FROM users WHERE active = 1;`,
  },
  {
    id: "sh-check-file",
    file: "scripts/load.sh",
    expect: "flag",
    rules: ["restate"],
    note: "Google shell style: '[[ -f ]]' already reads as the comment.",
    code: `
# Check if file exists
if [[ -f "\${data_file}" ]]; then
  load "\${data_file}"
fi`,
  },
  {
    id: "html-header-restate",
    file: "site/index.html",
    expect: "flag",
    rules: ["restate"],
    note: "algocademy: comment repeats the <header> element.",
    code: `
<!-- header -->
<header>
  <h1>Title</h1>
</header>`,
  },
  {
    id: "html-nav-banner",
    file: "site/nav.html",
    expect: "flag",
    rules: ["section-label"],
    note: "carlosschults: decorative banner over the <nav> element.",
    code: `
<!-- ============================================ -->
<!--                 NAVIGATION                   -->
<!-- ============================================ -->
<nav><a href="/">Home</a></nav>`,
  },
  {
    id: "css-set-red",
    file: "styles/error.css",
    expect: "flag",
    rules: ["restate"],
    note: "thelinuxcode: declaration already says exactly this.",
    code: `
.error {
  /* set color to red */
  color: red;
}`,
  },
  {
    id: "css-file-header",
    file: "styles/main.css",
    expect: "flag",
    rules: ["doc-padding", "narration"],
    note: "carlosschults: boilerplate file header with author/date.",
    code: `
/**
 * File: styles.css
 * Author: Jane Doe
 * Description: This is the stylesheet.
 * Created: 2018
 */
body { margin: 0; }`,
  },

  // ============================================================
  // REAL verbose-but-true comments that must still FLAG (shrink):
  // every sentence is accurate, but the point fits in far fewer lines.
  // ============================================================
  {
    id: "java-hashmap-treeify-verbose",
    file: "src/main/java/HashMap.java",
    expect: "flag",
    rules: ["oversized"],
    note: "OpenJDK HashMap rationale (real) but 4 lines where 1-2 carry it.",
    code: `
class HashMap {
    // Because TreeNodes are about twice the size of regular nodes, we
    // use them only when bins contain enough nodes to warrant use
    // (see TREEIFY_THRESHOLD). And when they become too small (due to
    // removal or resizing) they are converted back to plain bins.
    void treeify() {}
}`,
  },
  {
    id: "go-time-eq-verbose",
    file: "time/time.go",
    expect: "flag",
    rules: ["oversized"],
    note: "Go stdlib gotcha (real) but a 4-line block a sentence can carry.",
    code: `
// Note that the Go == operator compares not just the time instant but also the
// Location and the monotonic clock reading. Therefore, Time values should not
// be used as map or database keys without first guaranteeing that the
// identical Location has been set for all values.
func (t Time) Equal(u Time) bool { return t.eq(u) }`,
  },
  {
    id: "react-settextcontent-verbose",
    file: "src/setTextContent.js",
    expect: "flag",
    rules: ["oversized"],
    note: "React perf note (real) but 3 lines compressible to one.",
    code: `
/**
 * Set the textContent property of a node. For text updates, it's faster
 * to set the \`nodeValue\` of the Text node directly instead of using
 * \`.textContent\` which will remove the existing node and create a new one.
 */
function setTextContent(node, text) {
  node.firstChild.nodeValue = text;
}`,
  },

  // ============================================================
  // REAL good comments that must PASS: short why / constraint / invariant /
  // gotcha / safety, verbatim from widely respected repos.
  // ============================================================
  {
    id: "ts-release-ref",
    file: "src/queue.ts",
    expect: "pass",
    note: "TypeScript compiler core.ts (real): one-line why for the undefined write.",
    code: `
function dequeue<T>(elements: (T | undefined)[], headIndex: number): T {
  const result = elements[headIndex] as T;
  elements[headIndex] = undefined; // Don't keep referencing dequeued item
  return result;
}`,
  },
  {
    id: "cs-donotrename",
    file: "src/List.cs",
    expect: "pass",
    note: ".NET runtime List<T> (real): keep-in-sync serialization constraint.",
    code: `
internal T[] _items; // Do not rename (binary serialization)
internal int _size;  // Do not rename (binary serialization)`,
  },
  {
    id: "cs-uint-cast-trick",
    file: "src/List2.cs",
    expect: "pass",
    note: ".NET runtime List<T> (real): one-line why for the unsigned cast.",
    code: `
public T Get(int index) {
    // Following trick can reduce the range check by one
    if ((uint)index >= (uint)_size)
        ThrowHelper.ThrowArgumentOutOfRange();
    return _items[index];
}`,
  },
  {
    id: "php-symfony-rfc",
    file: "src/Response.php",
    expect: "pass",
    note: "Symfony Response.php (real): spec-mandated behaviour, cites RFC.",
    code: `
// according to RFC 2616 invalid date formats (e.g. "0" and "-1") must be treated as in the past
if (!$date instanceof \\DateTimeInterface) {
    $date = new \\DateTime('@0');
}`,
  },
  {
    id: "php-laravel-closure",
    file: "src/Arr.php",
    expect: "pass",
    note: "Laravel Arr.php (real): one-line why for the null assignment.",
    code: `
$flatten = function ($array) use (&$flatten) {
    return $array;
};
// Destroy self-referencing closure to avoid memory leak
$flatten = null;`,
  },
  {
    id: "c-alloc-before-assign",
    file: "src/zend_hash.c",
    expect: "pass",
    note: "php-src Zend (real): one-line ordering constraint on OOM.",
    code: `
// Alloc before assign to avoid inconsistencies on OOM
p->key = zend_string_alloc(len, 0);
ht->arData[idx] = *p;`,
  },
  {
    id: "curl-only-way",
    file: "lib/ftp.c",
    expect: "pass",
    note: "curl ftp.c (real): one-line enforced invariant.",
    code: `
/* This is the ONLY way to change FTP state! */
static void ftp_state_low(struct Curl_easy *data, ftpstate newstate) {
  data->conn->proto.ftpc.state = newstate;
}`,
  },
  {
    id: "curl-type-before-size",
    file: "lib/ftp2.c",
    expect: "pass",
    note: "curl ftp.c (real): 2-line ordering constraint from server behaviour.",
    code: `
/* Some servers return different sizes for different modes, and thus we
   must set the proper type before we check the size */
set_type(conn);
check_size(conn);`,
  },
  {
    id: "redis-rehashidx",
    file: "src/dict.c",
    expect: "pass",
    note: "redis dict.c (real): 2-line invariant justifying the assert.",
    code: `
/* Note that rehashidx can't overflow as we are sure there are more
 * elements because ht[0].used != 0 */
assert(DICTHT_SIZE(d->ht_size_exp[0]) > (unsigned long)d->rehashidx);`,
  },
  {
    id: "git-nsec-racy",
    file: "read-cache.c",
    expect: "pass",
    note: "git read-cache.c (real): one-line gotcha.",
    code: `
#ifdef USE_NSEC
    /* nanosecond timestamped files can also be racy! */
    if (fstat_is_racy(istate, st))
        return 1;
#endif`,
  },
  {
    id: "leveldb-acquire-load",
    file: "db/skiplist.h",
    expect: "pass",
    note: "LevelDB skiplist.h (real): 2-line why for the memory order.",
    code: `
Node* Next(int n) {
  // Use an 'acquire load' so that we observe a fully initialized
  // version of the returned Node.
  return next_[n].load(std::memory_order_acquire);
}`,
  },
  {
    id: "swift-manual-spec",
    file: "src/Array.swift",
    expect: "pass",
    note: "Swift stdlib Array.swift (real): 2-line why blocking a DRY refactor.",
    code: `
// NOTE: this is a manual specialization of index movement for a Strideable
// index that is required for Array performance.
func formIndex(after i: inout Int) { i += 1 }`,
  },
  {
    id: "swift-mutation-invariant",
    file: "src/Array2.swift",
    expect: "pass",
    note: "Swift stdlib Array.swift (real): 2-line mutation-sequencing invariant.",
    code: `
// After a call to \`_endMutation\` the buffer must not be mutated until a call
// to \`_makeMutableAndUnique\`.
func _endMutation() { _buffer.endCOWMutation() }`,
  },
  {
    id: "kotlin-exception-safety",
    file: "src/main/kotlin/Strings.kt",
    expect: "pass",
    note: "Kotlin stdlib Strings.kt (real): one-line ordering for exception safety.",
    code: `
override fun computeNext() {
    // Update fields after the main loop to avoid inconsistent iterator state in case of an exception.
    state = HAS_NEXT
    delimiterLength = _delimiterLength
}`,
  },
  {
    id: "go-sort-doc",
    file: "sort/sort.go",
    expect: "pass",
    note: "Go stdlib sort.go (real): canonical one-line godoc.",
    code: `
// Sort sorts data in ascending order as determined by the Less method.
func Sort(data Interface) {
	stable(data, data.Len())
}`,
  },
  {
    id: "rust-drop-doc",
    file: "src/mem.rs",
    expect: "pass",
    note: "Rust core mem.rs (real): minimal rustdoc summary.",
    code: `
/// Disposes of a value.
pub const fn drop<T>(_x: T) {}`,
  },
  {
    id: "java-hashmap-poweroftwo",
    file: "src/main/java/HashMap2.java",
    expect: "pass",
    note: "OpenJDK HashMap (real): one-line invariant doc on the constant.",
    code: `
class HashMap2 {
    /** The default initial capacity - MUST be a power of two. */
    static final int DEFAULT_INITIAL_CAPACITY = 1 << 4;
}`,
  },
  {
    id: "rails-bigdecimal",
    file: "lib/quoting.rb",
    expect: "pass",
    note: "Rails quoting.rb (real): one-line gotcha preventing a cleanup.",
    code: `
def quote(value)
  case value
  # BigDecimals need to be put in a non-normalized form and quoted.
  when BigDecimal then value.to_s("F")
  end
end`,
  },
  {
    id: "kubernetes-ordering",
    file: "pkg/kubelet/kubelet.go",
    expect: "pass",
    note: "Kubernetes kubelet.go (real): call-ordering requirement, led by the constraint.",
    code: `
// NewInitializedVolumePluginMgr must be called before Kubelet is initialized, so
// the Node ReadyState is accurate with the storage state.
func NewInitializedVolumePluginMgr() *VolumePluginMgr {
	return &VolumePluginMgr{}
}`,
  },
  {
    id: "react-todo-scoped",
    file: "src/ReactDOMInput.js",
    expect: "pass",
    note: "React (real): scoped TODO linked to a tracking issue.",
    code: `
function updateInput(node) {
  // TODO: Should really update input value tracking for the whole radio
  // button group in an effect or something (similar to #27024)
  node.checked = true;
}`,
  },
  {
    id: "leveldb-todo-precondition",
    file: "db/skiplist2.h",
    expect: "pass",
    note: "LevelDB (real): TODO recording the precondition that makes it safe.",
    code: `
void Insert(const Key& key) {
  // TODO(opt): We can use a barrier-free variant of FindGreaterOrEqual()
  // here since Insert() is externally synchronized.
  FindGreaterOrEqual(key);
}`,
  },
];
