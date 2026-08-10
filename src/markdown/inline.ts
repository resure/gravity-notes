/**
 * Inline HTML ↔ inline Markdown, for the span level only (block structure lives in
 * `toMarkdown`/`fromMarkdown`).
 *
 * The editor stores a block's content as the inner HTML of its contentEditable, restricted to a
 * small allowlist (`<strong> <b> <em> <i> <u> <s> <strike> <code> <a> <br>` plus the `<div>`/`<p>`
 * wrappers the browser sometimes normalizes into). Notes on disk are Markdown, so every save
 * converts one to the other.
 *
 * Both directions are hand-rolled rather than DOM-based: they must run in a plain Node test
 * environment (and inside the storage path, where no document is guaranteed), and the grammar is
 * small enough that a scanner is clearer than a parser dependency.
 *
 * Round-trip losses are deliberate and documented in ARCHITECTURE.md:
 * - `<u>` has no Markdown spelling, so it survives as literal inline HTML (Markdown allows it);
 * - unknown tags are dropped by the editor's own sanitizer long before they reach here.
 */

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

/** Decode the handful of entities the editor's own markup can contain. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code =
                body[1] === 'x' || body[1] === 'X'
                    ? Number.parseInt(body.slice(2), 16)
                    : Number.parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[body.toLowerCase()] ?? whole;
    });
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Characters that would otherwise be read back as inline Markdown syntax. */
const ESCAPABLE = /[\\`*[\]]/g;

/**
 * Two or more `~` in a row — the strikethrough delimiter, and the only form of `~` that carries
 * meaning (a lone tilde is literal in CommonMark, exactly like an intra-word `_`). Escaping every
 * `~` rewrote `~4 min` and `~$117` on disk to `\~4 min` / `\~$117` the first time such a note was
 * saved, which is both ugly and a difference the round-trip guard then held against the file.
 */
const STRIKE_RUN = /~{2,}/g;

/** A `[[wiki link]]`, which must reach the file verbatim. */
const WIKI_LINK = /\[\[[^[\]\n]+\]\]/g;

/**
 * Escape a plain-text run so it survives a Markdown round-trip as literal text.
 *
 * Two deliberate exemptions:
 *
 * - **`[[wiki links]]` are never escaped.** They are stored as the literal bytes Obsidian writes,
 *   which is what makes a vault work in both apps — and what the backlink graph scans for. Escaping
 *   their brackets would round-trip fine through *this* parser and be invisible to every other tool.
 * - **`_` is not escaped.** CommonMark ignores intra-word underscores, so escaping them would turn
 *   every `snake_case` identifier into `snake\_case` on disk for no gain. A `_` that genuinely opens
 *   emphasis is re-read as emphasis — a rare, accepted loss in exchange for readable files.
 * - **A lone `~` is not escaped**, for the same reason: only `~~` opens strikethrough, so `~4 min`
 *   is already literal. See {@link STRIKE_RUN}.
 */
export function escapeMarkdownText(text: string): string {
    const escape = (run: string) =>
        run
            .replace(ESCAPABLE, (char) => `\\${char}`)
            .replace(STRIKE_RUN, (tildes) => tildes.replace(/~/g, '\\~'));
    let out = '';
    let last = 0;
    for (const match of text.matchAll(WIKI_LINK)) {
        const start = match.index ?? 0;
        out += escape(text.slice(last, start)) + match[0];
        last = start + match[0].length;
    }
    return out + escape(text.slice(last));
}

/** Length of the longest consecutive run of `char` in `text`. */
function longestRunOf(text: string, char: string): number {
    let longest = 0;
    let current = 0;
    for (const candidate of text) {
        current = candidate === char ? current + 1 : 0;
        if (current > longest) longest = current;
    }
    return longest;
}

interface Tag {
    name: string;
    closing: boolean;
    selfClosing: boolean;
    attrs: Record<string, string>;
}

/** Parse one `<...>` tag body (already stripped of its angle brackets). */
function parseTag(raw: string): Tag | null {
    const match = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)$/.exec(raw);
    if (!match) return null;
    const [, slash, name, rest, selfSlash] = match;
    const attrs: Record<string, string> = {};
    for (const attr of rest.matchAll(
        /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g,
    )) {
        const key = (attr[1] ?? attr[3]).toLowerCase();
        attrs[key] = decodeEntities(attr[2] ?? attr[4]);
    }
    return {
        name: name.toLowerCase(),
        closing: slash === '/',
        selfClosing: selfSlash === '/',
        attrs,
    };
}

/**
 * The class the editor puts on a `[[wiki link]]`'s styling wrapper.
 *
 * The wrapper is STYLE-ONLY: its text content stays the literal `[[Title]]` bytes, so serializing it
 * back is just "drop the tag, keep the text" — which the scanner below already does for any tag it
 * has no Markdown spelling for. That is the whole reason the wrapper is safe: the block engine
 * re-serializes the entire document from the live DOM on every keystroke, so a decoration that HID
 * the brackets would rewrite every `[[Title]]` in the file to a bare `Title` on the first edit
 * anywhere in it. (`NotePreview` hides them because it is read-only and never writes back.)
 */
export const WIKI_LINK_CLASS = 'wiki-link';

/** Markdown delimiters for the tags that have one. */
const WRAPPERS: Record<string, string> = {
    strong: '**',
    b: '**',
    em: '*',
    i: '*',
    s: '~~',
    strike: '~~',
    del: '~~',
};

/**
 * Serialize a block's inner HTML to inline Markdown.
 *
 * A `<br>` (and the `<div>`/`<p>` boundaries the browser normalizes multi-line content into)
 * becomes a plain newline — a Markdown soft break, which is what Obsidian and friends render as a
 * line break and, crucially, what they leave alone. The block parser folds a soft break back into a
 * `<br>`, so a soft-broken paragraph stays ONE block across a save/load cycle without the file
 * growing backslashes it didn't have.
 */
export function inlineHtmlToMarkdown(html: string): string {
    let out = '';
    let index = 0;
    // Inside a <code> span nothing is escaped and no nested markup applies.
    let codeDepth = 0;
    // The delimiter the open <code> chose, held so the matching close can repeat it.
    let codeFence = '`';
    // `start` is where this anchor's content begins in `out`, so an autolink whose label has been
    // EDITED can rewind and re-emit itself in the `[label](href)` form (see the closing tag below).
    const openLinks: {href: string; autolink: boolean; start: number; text: string}[] = [];

    const pushText = (text: string) => {
        const decoded = decodeEntities(text);
        const open = openLinks[openLinks.length - 1];
        // An autolink's label IS its destination, so while it still matches the href the text
        // carries no information and must not be emitted twice — but it is a live contentEditable,
        // and text typed inside one has to survive. Collect it and let the close decide.
        if (open?.autolink) {
            open.text += decoded;
            return;
        }
        out += codeDepth > 0 ? decoded : escapeMarkdownText(decoded);
    };

    while (index < html.length) {
        const lt = html.indexOf('<', index);
        if (lt === -1) {
            pushText(html.slice(index));
            break;
        }
        if (lt > index) pushText(html.slice(index, lt));
        const gt = html.indexOf('>', lt);
        if (gt === -1) {
            pushText(html.slice(lt));
            break;
        }
        const tag = parseTag(html.slice(lt + 1, gt));
        index = gt + 1;
        if (!tag) continue;

        if (tag.name === 'br') {
            out += '\n';
            continue;
        }
        if (tag.name === 'div' || tag.name === 'p') {
            // A wrapper boundary is a line break, but only between content (never leading/trailing).
            if (out && !out.endsWith('\n')) out += '\n';
            continue;
        }
        if (tag.name === 'code') {
            if (tag.closing) {
                codeDepth = Math.max(0, codeDepth - 1);
                out += codeFence;
                codeFence = '`';
                continue;
            }
            // Size the fence to the content BEFORE opening it: a span holding a backtick needs a
            // longer delimiter, exactly as the block-level writer does for fenced code. A fixed
            // single backtick truncated the span at its first interior one, spilling the rest into
            // the prose as literal text plus a dangling backtick — which anyone writing about
            // Markdown or shell quoting hits immediately.
            const close = html.toLowerCase().indexOf('</code>', index);
            const body = decodeEntities(html.slice(index, close === -1 ? html.length : close));
            codeFence = '`'.repeat(longestRunOf(body, '`') + 1);
            codeDepth += 1;
            out += codeFence;
            // A span that opens or ends with a backtick needs padding spaces, which the reader strips.
            if (body.startsWith('`') || body.endsWith('`')) out += ' ';
            continue;
        }
        if (tag.name === 'u') {
            // No Markdown equivalent — keep the literal tag (Markdown passes inline HTML through).
            out += tag.closing ? '</u>' : '<u>';
            continue;
        }
        if (tag.name === 'a') {
            if (tag.closing) {
                const link = openLinks.pop();
                // `<https://…>` — the autolink form, flagged on the anchor at parse time so the two
                // spellings never trade places on disk. Without the flag every autolink would
                // re-serialize as `[url](url)`, which is a different (and uglier) file than the one
                // that was opened, on a surface that rewrites the whole note per keystroke.
                if (link?.autolink) {
                    // The caret can sit inside a rendered link, so its label is editable. Once it
                    // stops matching the href it is no longer an autolink and has to be written in
                    // the form that can hold both halves — otherwise every character typed inside
                    // one would be dropped on the next serialize, which is per keystroke here.
                    out = out.slice(0, link.start);
                    if (link.text === '' || link.text === link.href) out += `<${link.href}>`;
                    else {
                        out += `[${escapeMarkdownText(link.text)}](${encodeLinkDestination(link.href)})`;
                    }
                } else out += `](${encodeLinkDestination(link?.href ?? '')})`;
            } else {
                const autolink = tag.attrs['data-autolink'] !== undefined;
                openLinks.push({
                    href: tag.attrs.href ?? '',
                    autolink,
                    start: out.length,
                    text: '',
                });
                if (!autolink) out += '[';
            }
            continue;
        }
        const wrapper = WRAPPERS[tag.name];
        if (wrapper) out += wrapper;
    }
    // A trailing break (a closing `</div>`, or a stray `<br>` at the end) carries no meaning and
    // would come back as an empty last line.
    return out.replace(/\n+$/, '');
}

/**
 * Wrap a URL in `<>` when it contains characters that would break the `(...)` destination.
 *
 * Whitespace always needs the wrapper. Parentheses only need it when they are UNBALANCED: the reader
 * counts nesting, so `…/Rust_(programming_language)` closes correctly on its own, and wrapping it
 * anyway meant every note holding a Wikipedia link was rewritten the first time it was saved.
 */
export function encodeLinkDestination(href: string): string {
    return /\s/.test(href) || !hasBalancedParens(href) ? `<${href}>` : href;
}

function hasBalancedParens(text: string): boolean {
    let depth = 0;
    for (const char of text) {
        if (char === '(') depth++;
        else if (char === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

/**
 * A CommonMark autolink whose scheme is one `openExternalUrl` will actually follow. Anything else
 * (`file:`, `javascript:`, a bare domain) stays literal text, exactly as before.
 */
const AUTOLINK = /^<((?:https?|mailto|tel):[^<>\s]+)>/i;

/** Inline Markdown → the editor's inner HTML. Inverse of {@link inlineHtmlToMarkdown}. */
export function inlineMarkdownToHtml(markdown: string): string {
    return parseInline(markdown);
}

/** True at `index` when the character is not escaped by a preceding backslash. */
function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
    return backslashes % 2 === 1;
}

function parseInline(text: string): string {
    let out = '';
    let i = 0;
    let plain = '';

    const flush = () => {
        out += escapeHtml(plain);
        plain = '';
    };

    while (i < text.length) {
        const char = text[i];

        // A line break inside one block's text — soft (plain newline, what we write) or hard
        // (backslash, which foreign files may use) — is the editor's <br>.
        if (char === '\n') {
            flush();
            out += '<br>';
            i++;
            continue;
        }

        if (char === '\\') {
            const next = text[i + 1];
            if (next === '\n') {
                flush();
                out += '<br>';
                i += 2;
                continue;
            }
            if (next !== undefined && /[\\`*_~[\]()#+\-.!>]/.test(next)) {
                plain += next;
                i += 2;
                continue;
            }
            plain += char;
            i++;
            continue;
        }

        // A wiki link is opaque: its brackets are content, not link syntax. It gets a style-only
        // wrapper (see WIKI_LINK_CLASS) whose text is still the literal `[[Title]]`, so the editor
        // can colour it without the serializer having anything to undo.
        if (char === '[' && text[i + 1] === '[') {
            const end = text.indexOf(']]', i + 2);
            if (end !== -1) {
                const raw = text.slice(i, end + 2);
                // `[[]]` / `[[a]b]]` aren't links (same rule as wikiLinks.ts) — leave them as text.
                if (/^\[\[[^[\]\n]+\]\]$/.test(raw)) {
                    flush();
                    out += `<span class="${WIKI_LINK_CLASS}">${escapeHtml(raw)}</span>`;
                } else {
                    plain += raw;
                }
                i = end + 2;
                continue;
            }
        }

        if (char === '`') {
            const fence = /^`+/.exec(text.slice(i))![0];
            const close = text.indexOf(fence, i + fence.length);
            if (close !== -1) {
                flush();
                let body = text.slice(i + fence.length, close);
                // CommonMark: one leading AND trailing space is padding (it is what lets a span
                // start or end with a backtick), not content. The writer adds it for exactly that.
                if (body.length > 2 && body.startsWith(' ') && body.endsWith(' ')) {
                    body = body.slice(1, -1);
                }
                out += `<code>${escapeHtml(body)}</code>`;
                i = close + fence.length;
                continue;
            }
        }

        if (char === '<') {
            // Inline HTML the writer emits verbatim (`<u>`, `<br>`).
            const match = /^<(\/?)(u|br)\s*\/?>/i.exec(text.slice(i));
            if (match) {
                flush();
                out += match[2].toLowerCase() === 'br' ? '<br>' : match[1] ? '</u>' : '<u>';
                i += match[0].length;
                continue;
            }
            // CommonMark autolink: `<https://example.com>` renders as a real link. Restricted to the
            // schemes the app will actually open, so the editor's sanitizer can never strip the href
            // out from under a link the round-trip guard already blessed (a stripped href would
            // serialize back as `[text]()` and rewrite the file on the first keystroke).
            const autolink = AUTOLINK.exec(text.slice(i));
            if (autolink) {
                flush();
                const href = escapeHtml(autolink[1]);
                out += `<a href="${href}" data-autolink="" rel="noopener noreferrer">${href}</a>`;
                i += autolink[0].length;
                continue;
            }
        }

        if (char === '[') {
            const link = matchLink(text, i);
            if (link) {
                flush();
                out += `<a href="${escapeHtml(link.href)}" rel="noopener noreferrer">${parseInline(link.label)}</a>`;
                i = link.end;
                continue;
            }
        }

        if (char === '*' || char === '~' || char === '_') {
            const emphasis = matchEmphasis(text, i);
            if (emphasis) {
                flush();
                out += `<${emphasis.tag}>${parseInline(emphasis.inner)}</${emphasis.tag}>`;
                i = emphasis.end;
                continue;
            }
        }

        plain += char;
        i++;
    }
    flush();
    return out;
}

interface LinkMatch {
    label: string;
    href: string;
    end: number;
}

/** Match `[label](destination)` starting at `start` (which must be the `[`). */
function matchLink(text: string, start: number): LinkMatch | null {
    let depth = 0;
    let i = start;
    for (; i < text.length; i++) {
        if (isEscaped(text, i)) continue;
        if (text[i] === '[') depth++;
        else if (text[i] === ']') {
            depth--;
            if (depth === 0) break;
        }
    }
    if (depth !== 0 || text[i + 1] !== '(') return null;
    const destination = matchDestination(text, i + 2);
    if (!destination) return null;
    return {label: text.slice(start + 1, i), href: destination.href, end: destination.end};
}

/**
 * Read a link destination starting just after the `(`, returning the href and the index past the `)`.
 *
 * Two forms, and getting the first one wrong was silently destroying links. `encodeLinkDestination`
 * wraps any URL containing whitespace or parentheses in `<>` — so a naive `indexOf(')')` truncated
 * exactly the URLs the writer had gone out of its way to protect, leaving the tail (`>)`) behind as
 * literal body text. Wikipedia, JIRA and MSDN URLs routinely carry parens, and because the mangled
 * form re-serialized to a *different* mangled form, every save chewed further into the link.
 *
 * The bare form now balances nested parens instead of stopping at the first one, which is what
 * CommonMark does and what makes `…/Foo_(bar)` survive without the `<>` wrapper at all.
 */
function matchDestination(text: string, start: number): {href: string; end: number} | null {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;

    if (text[i] === '<') {
        const close = text.indexOf('>', i + 1);
        if (close === -1) return null;
        const href = text.slice(i + 1, close);
        let after = close + 1;
        while (after < text.length && /\s/.test(text[after])) after++;
        if (text[after] !== ')') return null;
        return {href, end: after + 1};
    }

    let depth = 0;
    const from = i;
    for (; i < text.length; i++) {
        if (isEscaped(text, i)) continue;
        const char = text[i];
        if (char === '(') depth++;
        else if (char === ')') {
            if (depth === 0) return {href: text.slice(from, i).trim(), end: i + 1};
            depth--;
        }
    }
    return null;
}

interface EmphasisMatch {
    tag: 'strong' | 'em' | 's';
    inner: string;
    end: number;
}

/** Match `**strong**`, `*em*`, `_em_`, or `~~strike~~` starting at `start`. */
function matchEmphasis(text: string, start: number): EmphasisMatch | null {
    const char = text[start];
    const double = text[start + 1] === char;
    const marker = double ? char + char : char;
    if (char === '~' && !double) return null; // single ~ is literal
    if (char === '_' && !double) {
        // Intra-word underscores are literal (matching the escape policy in escapeMarkdownText).
        const before = text[start - 1];
        if (before && /[\w]/.test(before)) return null;
    }
    const from = start + marker.length;
    if (text[from] === undefined || /\s/.test(text[from])) return null;
    let i = from;
    while (i < text.length) {
        const next = text.indexOf(marker, i);
        if (next === -1) return null;
        if (isEscaped(text, next)) {
            i = next + marker.length;
            continue;
        }
        if (/\s/.test(text[next - 1] ?? '')) {
            i = next + marker.length;
            continue;
        }
        let run = 0;
        while (text[next + run] === char) run++;
        // A closing run longer than this marker is shared with a NESTED span, and which end of it we
        // take decides who gets the surplus. Settle it by asking whether the content would be left
        // holding an unpaired marker:
        //
        //   `**bold *and italic***` — content `bold *and italic` has one unpaired `*`, so that `*`
        //   must close it: the outer `**` takes the LAST two markers.
        //   `**a***b*` — content `a` is balanced, so the surplus belongs to the span that FOLLOWS:
        //   the `**` takes the FIRST two and leaves a `*` to open the italic.
        //
        // Taking the last N unconditionally (the previous rule) got the second case wrong, closing
        // the bold one marker late: `<strong>a*</strong>b*`, a stray asterisk inside the bold and the
        // italic lost. Since that re-serialized to a *different* broken string, every save chewed
        // further in — three cycles turned all the formatting into literal asterisks.
        let unpaired = 0;
        for (let at = from; at < next; at++) {
            if (text[at] === char && !isEscaped(text, at)) unpaired++;
        }
        const closeAt =
            unpaired % 2 === 1 && run > marker.length ? next + run - marker.length : next;
        const tag = char === '~' ? 's' : double ? 'strong' : 'em';
        return {tag, inner: text.slice(from, closeAt), end: closeAt + marker.length};
    }
    return null;
}

/** Plain text of a block's inner HTML — for titles, previews, and table-free comparisons. */
export function inlineHtmlToText(html: string): string {
    return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''));
}

/**
 * Plain text of a block's inner HTML, preserving line structure — for CODE blocks, whose content is
 * literal text spread over real lines.
 *
 * {@link inlineHtmlToText} flattens a `<br>` to a space, which is right for a title or a preview and
 * catastrophic here: `Turn into ▸ Code` copies a paragraph's html verbatim, `<br>`s included, so
 * serializing through the flattening version collapsed a multi-line snippet onto one line and
 * autosaved it that way. Code blocks loaded from disk hold real newlines and were unaffected, which
 * is why the round trip looked stable while the edit path quietly destroyed line breaks.
 */
export function inlineHtmlToCodeText(html: string): string {
    return decodeEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            // The browser normalizes multi-line contentEditable content into wrappers; each boundary
            // is a line break, the same reading `inlineHtmlToMarkdown` gives them.
            .replace(/<\/(?:div|p)>/gi, '\n')
            .replace(/<[^>]*>/g, ''),
    ).replace(/\n$/, '');
}
