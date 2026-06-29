/**
 * Pure full-text search: tokenizing, ranked scoring, and snippet extraction. No I/O and no React —
 * the corpus (note id → body) is loaded above this by `useNoteSearch` and passed in, so this stays
 * trivially unit-testable and backend-agnostic.
 *
 * Matching is multi-term AND: every term must appear somewhere (title or body). Ranking floats
 * title hits above body-only hits, and word-boundary / prefix / whole-phrase matches above bare
 * mid-word substrings — so "release" surfaces a note titled "Release notes" before one that merely
 * mentions the word in passing.
 */

import type {NoteMeta} from './storage/types';

/** Split a raw query into lowercased, whitespace-separated search terms. */
export function tokenizeQuery(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Escape a string for literal use inside a `RegExp` (terms can contain `.`, `*`, etc.). */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Field weights, tuned so any title hit outranks a body-only hit, and exact/prefix/word-start
// matches outrank bare mid-word substrings. Relative magnitudes matter, not the absolute numbers.
const TITLE_TERM = 40; // term appears anywhere in the title
const TITLE_WORD_START = 25; // …and at a word boundary
const TITLE_PREFIX = 15; // …and the title starts with it
const BODY_TERM = 8; // term appears anywhere in the body
const BODY_WORD_START = 6; // …and at a word boundary
const BODY_FREQ = 1; // per extra body occurrence,
const BODY_FREQ_CAP = 5; // …capped, so a spammed word can't dominate
const PHRASE_TITLE = 30; // the whole multi-term query appears contiguously in the title
const PHRASE_TITLE_PREFIX = 15; // …at the very start

/** True when `text[index]` begins a word (string start, or preceded by a non-alphanumeric char). */
function isWordStart(text: string, index: number): boolean {
    if (index <= 0) return true;
    return !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '');
}

/** Index of the first word-boundary occurrence of `term` in `text`, or -1. */
function wordStartIndex(text: string, term: string): number {
    let from = 0;
    for (;;) {
        const idx = text.indexOf(term, from);
        if (idx === -1) return -1;
        if (isWordStart(text, idx)) return idx;
        from = idx + 1;
    }
}

/** Count non-overlapping occurrences of `term` in `text` (used for the small frequency bonus). */
function countOccurrences(text: string, term: string): number {
    let count = 0;
    let from = 0;
    for (;;) {
        const idx = text.indexOf(term, from);
        if (idx === -1) return count;
        count += 1;
        from = idx + term.length;
    }
}

/** Outcome of scoring one note: its relevance score and whether any term hit the body. */
export interface NoteScore {
    score: number;
    /** True when at least one term matched the body — gates whether a snippet is worth building. */
    bodyMatched: boolean;
}

/**
 * Relevance score for one note's title and body — both already lowercased — against `terms`, or
 * `null` when any term is absent from both (AND semantics → the note doesn't match). `phrase` is the
 * terms rejoined with single spaces; pass `usePhrase` only when there's more than one term, so the
 * phrase bonus doesn't just double-count a single term's title hit.
 */
export function scoreNoteText(
    lowerTitle: string,
    lowerBody: string,
    terms: string[],
    phrase: string,
    usePhrase: boolean,
): NoteScore | null {
    let score = 0;
    let bodyMatched = false;
    for (const term of terms) {
        if (!term) continue; // callers pass non-empty terms; guard so an empty one can't hang loops
        let matched = false;
        if (lowerTitle.includes(term)) {
            matched = true;
            score += TITLE_TERM;
            if (wordStartIndex(lowerTitle, term) !== -1) score += TITLE_WORD_START;
            if (lowerTitle.startsWith(term)) score += TITLE_PREFIX;
        }
        if (lowerBody.includes(term)) {
            matched = true;
            bodyMatched = true;
            score += BODY_TERM;
            if (wordStartIndex(lowerBody, term) !== -1) score += BODY_WORD_START;
            score += Math.min(countOccurrences(lowerBody, term) - 1, BODY_FREQ_CAP) * BODY_FREQ;
        }
        if (!matched) return null;
    }
    if (usePhrase && lowerTitle.includes(phrase)) {
        score += PHRASE_TITLE;
        if (lowerTitle.startsWith(phrase)) score += PHRASE_TITLE_PREFIX;
    }
    return {score, bodyMatched};
}

// Chars of context kept BEFORE the match — deliberately small so the highlighted match stays within
// the visible part of the single-line, ellipsis-truncated list preview (a large lead would push the
// match off the right edge where the user can't see it). SNIPPET_MAX caps the snippet's length.
const SNIPPET_LEAD = 12;
const SNIPPET_MAX = 160;

/**
 * A readable one-line snippet of the body around the earliest term match, Markdown lightly stripped
 * and whitespace collapsed, with leading/trailing `…` when the window is clipped. `lowerBody` must be
 * `content.toLowerCase()` (the caller already has it); returns `undefined` when no term occurs in the
 * body so the caller can fall back to the note's normal preview.
 */
export function buildSnippet(
    content: string,
    lowerBody: string,
    terms: string[],
): string | undefined {
    if (!content || terms.length === 0) return undefined;
    let firstIdx = -1;
    let matchLen = 0;
    for (const term of terms) {
        if (!term) continue;
        const idx = lowerBody.indexOf(term);
        if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
            firstIdx = idx;
            matchLen = term.length;
        }
    }
    if (firstIdx === -1) return undefined;

    // All index math is in `lowerBody`'s coordinate space (where the match was found). Snap to word
    // boundaries using the same string so the window can't drift off the match. The match sits near
    // the start (only SNIPPET_LEAD chars of lead) so it stays visible when the preview is truncated.
    let start = Math.max(0, firstIdx - SNIPPET_LEAD);
    if (start > 0) {
        const space = lowerBody.indexOf(' ', start);
        if (space !== -1 && space < firstIdx) start = space + 1;
    }
    // Cap the length, but always extend past the match itself (so a long matched term isn't clipped).
    let end = Math.min(lowerBody.length, Math.max(start + SNIPPET_MAX, firstIdx + matchLen));
    if (end < lowerBody.length) {
        const space = lowerBody.lastIndexOf(' ', end);
        if (space > firstIdx + matchLen) end = space;
    }

    // Slice the original `content` (preserving case) only when it's index-aligned with `lowerBody`.
    // toLowerCase isn't always length-preserving (e.g. 'İ' → two units), which would shift indices
    // and drop the match; in that rare case fall back to the lowercased text.
    const source = content.length === lowerBody.length ? content : lowerBody;
    const cleaned = source
        .slice(start, end)
        .replace(/&nbsp;/g, ' ') // preserved empty-row markers (see EditorPane preserveEmptyRows)
        .replace(/[*_`~]/g, '') // inline emphasis / code / strike markers
        .replace(/\s+/g, ' ') // flow newlines + indentation into single spaces
        .trim();
    if (!cleaned) return undefined;
    return (start > 0 ? '…' : '') + cleaned + (end < lowerBody.length ? '…' : '');
}

export interface NoteSearchResult {
    note: NoteMeta;
    /** Relevance score (higher is better); 0 for an empty query. */
    score: number;
    /** Body snippet around the match, when the match is (also) in the body. */
    snippet?: string;
}

/**
 * Rank `notes` against `query` using `contentById` (note id → full body) for the body text. Notes
 * whose body isn't loaded yet match on title alone (so results show instantly, then refine once the
 * corpus arrives). Returns matches only, ordered by score, then most-recently-updated, then title.
 * An empty query returns every note in its original order, unscored.
 *
 * `lowerById` is an optional precomputed index of `id → body.toLowerCase()`. When the caller keeps
 * a warm search index (see `useNoteSearch`), pass it so a big corpus isn't re-lowercased on every
 * keystroke — the single biggest avoidable cost when searching a large folder. Omit it and the body
 * is lowercased on the fly, so direct/unindexed callers still work unchanged.
 */
export function searchNotes(
    notes: NoteMeta[],
    contentById: Map<string, string>,
    query: string,
    lowerById?: Map<string, string>,
): NoteSearchResult[] {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return notes.map((note) => ({note, score: 0}));
    const phrase = terms.join(' ');
    const usePhrase = terms.length > 1;

    const results: NoteSearchResult[] = [];
    for (const note of notes) {
        const content = contentById.get(note.id) ?? '';
        // Prefer the precomputed lowercased body; fall back to lowercasing on the fly when no index
        // was supplied. Shared by scoring + snippet so it's only computed once either way.
        const lowerBody = lowerById?.get(note.id) ?? content.toLowerCase();
        const scored = scoreNoteText(note.title.toLowerCase(), lowerBody, terms, phrase, usePhrase);
        if (!scored) continue;
        const snippet = scored.bodyMatched ? buildSnippet(content, lowerBody, terms) : undefined;
        results.push({note, score: scored.score, snippet});
    }
    results.sort(
        (a, b) =>
            b.score - a.score ||
            (b.note.updatedAt ?? 0) - (a.note.updatedAt ?? 0) ||
            a.note.title.localeCompare(b.note.title) ||
            // Final tiebreak on the full path-id so two same-leaf notes in different folders
            // (Archive/Notes.md vs Inbox/Notes.md) order deterministically across sessions,
            // rather than falling to nondeterministic store-listing order.
            a.note.id.localeCompare(b.note.id),
    );
    return results;
}
