/**
 * Pure helpers for `[[wiki links]]`: finding them in a body, resolving a target to a note id, and
 * inverting the link graph into backlinks. No I/O and no React — the corpus (note id → body) is
 * loaded above this (like {@link ./search}) and passed in, so this stays trivially unit-testable and
 * backend-agnostic.
 *
 * A link's target is matched to a note by *title* (the file-name leaf without `.md`),
 * case-insensitively. A target that carries a slash is also tried as an explicit relative path
 * (`Folder/Note` → `Folder/Note.md`). An `|alias` (Obsidian-style display text) and a `#heading`
 * anchor are accepted and ignored for resolution. On disk the note keeps the literal `[[target]]`,
 * so it round-trips through any Markdown tool.
 */

import {MD_EXT, dirname, titleFromFileName} from './storage/noteText';
import type {NoteMeta} from './storage/types';

/** One `[[target]]` occurrence found in a note body. */
export interface WikiLinkRef {
    /** Raw text between the brackets, trimmed (may still carry an `|alias` / `#heading`). */
    target: string;
    /** Char offset of the opening `[[` in the source body (for snippet building). */
    index: number;
    /** Length of the whole `[[…]]` match. */
    length: number;
}

// A link is `[[` … `]]` with at least one inner char that isn't a bracket or newline — so it never
// spans lines and `[[a]b]]` / `[[]]` don't match. Global, since a body can hold many.
const WIKI_LINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** Every `[[target]]` occurrence in `text` (empty/whitespace-only targets are skipped). */
export function extractWikiLinks(text: string): WikiLinkRef[] {
    const out: WikiLinkRef[] = [];
    for (const match of text.matchAll(WIKI_LINK_RE)) {
        const target = match[1].trim();
        if (!target) continue;
        out.push({target, index: match.index ?? 0, length: match[0].length});
    }
    return out;
}

/** Strip an `|alias` and a `#heading` anchor off a target, leaving just the note reference. */
function normalizeTarget(target: string): string {
    let ref = target.split('|', 1)[0]; // drop Obsidian-style display alias
    const hash = ref.indexOf('#');
    if (hash !== -1) ref = ref.slice(0, hash); // drop a #heading anchor
    return ref.trim();
}

/**
 * Resolve a `[[target]]` to a note id, relative to the note it was written in (`fromId`). Returns
 * `null` when nothing matches. A target with a slash is first tried as an explicit relative path;
 * otherwise it's matched by title. When several notes share a title, prefer one in the same folder as
 * `fromId`, then the shallowest path, then the lexicographically-first id (so it's stable).
 */
export function resolveWikiLink(target: string, fromId: string, notes: NoteMeta[]): string | null {
    const ref = normalizeTarget(target);
    if (!ref) return null;

    // Explicit relative-path form: "Folder/Note" (or "Folder/Note.md") → that exact id.
    if (ref.includes('/')) {
        const wantId = (ref.toLowerCase().endsWith(MD_EXT) ? ref : ref + MD_EXT).toLowerCase();
        const exact = notes.find((note) => note.id.toLowerCase() === wantId);
        if (exact) return exact.id;
        // No exact path hit — fall through and try matching the leaf as a bare title.
    }

    const wantTitle = titleFromFileName(ref).toLowerCase();
    const matches = notes.filter((note) => note.title.toLowerCase() === wantTitle);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0].id;

    const fromDir = dirname(fromId);
    return [...matches].sort((a, b) => {
        const aSame = dirname(a.id) === fromDir ? 0 : 1;
        const bSame = dirname(b.id) === fromDir ? 0 : 1;
        if (aSame !== bSame) return aSame - bSame; // same folder as the linker wins
        const aDepth = a.id.split('/').length;
        const bDepth = b.id.split('/').length;
        if (aDepth !== bDepth) return aDepth - bDepth; // then the shallowest
        return a.id.localeCompare(b.id); // then a stable tiebreak
    })[0].id;
}

// Context window kept around a backlink occurrence, mirroring search.ts's snippet sizing.
const CONTEXT_LEAD = 30;
const CONTEXT_MAX = 160;

/** A readable one-line snippet of `body` around `link`, lightly de-Markdowned, with `…` when clipped. */
function backlinkSnippet(body: string, link: WikiLinkRef): string {
    let start = Math.max(0, link.index - CONTEXT_LEAD);
    if (start > 0) {
        const space = body.indexOf(' ', start);
        if (space !== -1 && space < link.index) start = space + 1;
    }
    const matchEnd = link.index + link.length;
    let end = Math.min(body.length, Math.max(matchEnd + CONTEXT_LEAD, start + CONTEXT_MAX));
    if (end < body.length) {
        const space = body.lastIndexOf(' ', end);
        if (space > matchEnd) end = space;
    }
    const cleaned = body
        .slice(start, end)
        .replace(WIKI_LINK_RE, (_m, inner: string) => normalizeTarget(inner)) // [[x|y]] → x
        .replace(/&nbsp;/g, ' ') // preserved empty-row markers (see EditorPane preserveEmptyRows)
        .replace(/[*_`~]/g, '') // inline emphasis / code / strike markers
        .replace(/\s+/g, ' ') // flow newlines + indentation into single spaces
        .trim();
    return (start > 0 ? '…' : '') + cleaned + (end < body.length ? '…' : '');
}

/** True when `query` sits at a word boundary inside `title` (so "notes" matches "Release notes"). */
function titleWordStartsWith(title: string, query: string): boolean {
    let from = 0;
    for (;;) {
        const idx = title.indexOf(query, from);
        if (idx === -1) return false;
        if (idx === 0 || !/[\p{L}\p{N}]/u.test(title[idx - 1] ?? '')) return true;
        from = idx + 1;
    }
}

/**
 * Rank notes as `[[` autocomplete suggestions for `query`, best first (title match: exact ≫ prefix ≫
 * word-start ≫ substring; a same-folder note as `fromId` gets a small nudge; the linking note itself
 * is never suggested). An empty `query` lists notes by most-recently-updated. Pure, so it's shared by
 * the editor's suggest popup and unit tests.
 */
export function suggestWikiTargets(
    query: string,
    notes: NoteMeta[],
    fromId: string,
    limit = 8,
): NoteMeta[] {
    const q = query.trim().toLowerCase();
    const fromDir = dirname(fromId);
    const scored: {note: NoteMeta; score: number}[] = [];
    for (const note of notes) {
        if (note.id === fromId) continue; // don't suggest linking a note to itself
        const title = note.title.toLowerCase();
        let score: number;
        if (q === '') score = 0;
        else if (title === q) score = 100;
        else if (title.startsWith(q)) score = 80;
        else if (titleWordStartsWith(title, q)) score = 60;
        else if (title.includes(q)) score = 40;
        else continue;
        if (dirname(note.id) === fromDir) score += 5;
        scored.push({note, score});
    }
    scored.sort(
        (a, b) =>
            b.score - a.score ||
            (b.note.updatedAt ?? 0) - (a.note.updatedAt ?? 0) ||
            a.note.title.localeCompare(b.note.title) ||
            a.note.id.localeCompare(b.note.id),
    );
    return scored.slice(0, limit).map((s) => s.note);
}

/** One note that links to a given target, with the context around each of its links. */
export interface BacklinkSource {
    /** The linking note. */
    note: NoteMeta;
    /** A one-line context snippet for each `[[…]]` in this note that points at the target. */
    contexts: string[];
}

/**
 * Every note (other than the target itself) whose body links to `targetId` via a `[[wiki link]]`,
 * with the context around each link. `corpus` maps note id → body. Ordered most-recently-updated
 * first, then by title, then id (stable).
 */
export function buildBacklinks(
    targetId: string,
    notes: NoteMeta[],
    corpus: Map<string, string>,
): BacklinkSource[] {
    const out: BacklinkSource[] = [];
    for (const note of notes) {
        if (note.id === targetId) continue; // a note linking to itself isn't a backlink
        const body = corpus.get(note.id);
        if (!body) continue;
        const contexts: string[] = [];
        for (const link of extractWikiLinks(body)) {
            if (resolveWikiLink(link.target, note.id, notes) === targetId) {
                contexts.push(backlinkSnippet(body, link));
            }
        }
        if (contexts.length) out.push({note, contexts});
    }
    out.sort(
        (a, b) =>
            (b.note.updatedAt ?? 0) - (a.note.updatedAt ?? 0) ||
            a.note.title.localeCompare(b.note.title) ||
            a.note.id.localeCompare(b.note.id),
    );
    return out;
}
