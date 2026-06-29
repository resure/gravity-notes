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
 * Pre-indexed note list, so a batch of resolutions (e.g. {@link buildBacklinks}) is O(1) per link
 * instead of re-scanning every note. `byId` maps a lowercased id → its note; `byTitle` maps a
 * lowercased title → every note carrying it (the same-folder/shallowest tiebreak runs over this).
 */
interface ResolveIndex {
    byId: Map<string, NoteMeta>;
    byTitle: Map<string, NoteMeta[]>;
}

/** Build the {@link ResolveIndex} for `notes` once, to be shared across many `resolveWith` calls. */
function buildResolveIndex(notes: NoteMeta[]): ResolveIndex {
    const byId = new Map<string, NoteMeta>();
    const byTitle = new Map<string, NoteMeta[]>();
    for (const note of notes) {
        // First-wins, matching the old `notes.find(...)`: if two ids lowercase to the same string
        // (case-only-duplicate ids, possible on a case-sensitive filesystem), the earlier note in the
        // list resolves an explicit-path link, not the later one.
        const idKey = note.id.toLowerCase();
        if (!byId.has(idKey)) byId.set(idKey, note);
        const key = note.title.toLowerCase();
        const bucket = byTitle.get(key);
        if (bucket) bucket.push(note);
        else byTitle.set(key, [note]);
    }
    return {byId, byTitle};
}

/**
 * Map-based core of {@link resolveWikiLink}: resolve a `[[target]]` against a prebuilt index. Same
 * rules — explicit relative path first, else by title with the same-folder/shallowest/lexicographic
 * tiebreak — but lookups are O(1), so a whole backlink scan avoids the O(N²) re-filter.
 */
function resolveWith(target: string, fromId: string, index: ResolveIndex): string | null {
    const ref = normalizeTarget(target);
    if (!ref) return null;

    // Explicit relative-path form: "Folder/Note" (or "Folder/Note.md") → that exact id.
    if (ref.includes('/')) {
        const wantId = (ref.toLowerCase().endsWith(MD_EXT) ? ref : ref + MD_EXT).toLowerCase();
        const exact = index.byId.get(wantId);
        if (exact) return exact.id;
        // No exact path hit — fall through and try matching the leaf as a bare title.
    }

    const wantTitle = titleFromFileName(ref).toLowerCase();
    const matches = index.byTitle.get(wantTitle);
    if (!matches || matches.length === 0) return null;
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

/**
 * Resolve a `[[target]]` to a note id, relative to the note it was written in (`fromId`). Returns
 * `null` when nothing matches. A target with a slash is first tried as an explicit relative path;
 * otherwise it's matched by title. When several notes share a title, prefer one in the same folder as
 * `fromId`, then the shallowest path, then the lexicographically-first id (so it's stable).
 */
export function resolveWikiLink(target: string, fromId: string, notes: NoteMeta[]): string | null {
    return resolveWith(target, fromId, buildResolveIndex(notes));
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
        // Strips emphasis/code/strike markers unconditionally — a known cosmetic tradeoff: a literal
        // `*`/`_`/`` ` ``/`~` inside an identifier or path in the context also goes, but this is a
        // throwaway one-line preview, so we accept the occasional garbled char over real parsing.
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
 * One linking note in the (snippet-free) backlink inversion: the note plus the raw `[[…]]` refs in it
 * that resolve to the target. Holds link positions, not snippet strings — snippets are sliced lazily
 * in {@link materializeBacklinks} only for the target a view actually asks for, so a corpus change
 * never pays to snippet+sort every bucket (the dominant cost of the old eager build).
 */
export interface BacklinkBucketEntry {
    note: NoteMeta;
    /** The raw wiki-link refs in `note` that resolve to this bucket's target (positions preserved). */
    links: WikiLinkRef[];
}

/** Sort backlink sources newest-updated first, then by title, then id (stable). */
function sortBacklinkSources(sources: BacklinkSource[]): void {
    sources.sort(
        (a, b) =>
            (b.note.updatedAt ?? 0) - (a.note.updatedAt ?? 0) ||
            a.note.title.localeCompare(b.note.title) ||
            a.note.id.localeCompare(b.note.id),
    );
}

/**
 * Invert the link graph in one pass — WITHOUT building snippet strings or sorting. Returns
 * `targetId → the linking notes` (each carrying the raw `[[…]]` refs that point at it). This is the
 * cheap part (resolve + group); the expensive part (slicing a context snippet per link, per bucket)
 * is deferred to {@link materializeBacklinks}, called only for the open note's bucket.
 *
 * Build this ONCE per corpus change (it depends only on the notes + their links, not which note is
 * open); a note's backlinks are then an O(1) `Map.get` + a cheap snippet pass on open. `linksById` is
 * the precomputed `id → extractWikiLinks(body)` index; omit it and links are extracted here on the fly
 * (direct callers/tests), since this inversion no longer takes the bodies.
 */
export function buildBacklinkInversion(
    notes: NoteMeta[],
    linksById?: Map<string, WikiLinkRef[]>,
): Map<string, BacklinkBucketEntry[]> {
    // Build the resolution index once, not per link — keeps the whole pass O(N·L), not O(N²·L).
    const index = buildResolveIndex(notes);
    const map = new Map<string, BacklinkBucketEntry[]>();
    for (const note of notes) {
        // Prefer the precomputed links; fall back to extracting from the body when no index is given.
        const links = linksById?.get(note.id);
        if (!links || links.length === 0) continue;
        // Group this note's links by the target they resolve to, so a note linking to the same target
        // twice contributes one bucket entry carrying both raw refs.
        let perTarget: Map<string, WikiLinkRef[]> | null = null;
        for (const link of links) {
            const target = resolveWith(link.target, note.id, index);
            if (!target || target === note.id) continue; // a note linking to itself isn't a backlink
            perTarget ??= new Map();
            const existing = perTarget.get(target);
            if (existing) existing.push(link);
            else perTarget.set(target, [link]);
        }
        if (!perTarget) continue;
        for (const [target, refs] of perTarget) {
            const bucket = map.get(target);
            if (bucket) bucket.push({note, links: refs});
            else map.set(target, [{note, links: refs}]);
        }
    }
    // Intentionally NO snippet building / per-bucket sort here — deferred to materializeBacklinks.
    return map;
}

/**
 * Slice a context snippet per link + sort, for ONE bucket — the snippet/sort work the old eager build
 * did for *every* bucket up front. Called only for the open note's bucket (usually a handful of
 * sources), so it's negligible even though it touches each linking note's body. Returns a fresh,
 * sorted `BacklinkSource[]`; an absent/empty bucket yields `[]`.
 *
 * `notesById` (optional) maps id → the CURRENT note meta. The inversion is cached across plain edits,
 * so the `note` it stored can carry a stale `updatedAt`/title after a prose-only save; pass the live
 * map so display + the newest-first sort use the current meta without rebuilding the whole inversion.
 */
export function materializeBacklinks(
    bucket: ReadonlyArray<BacklinkBucketEntry> | undefined,
    corpus: Map<string, string>,
    notesById?: Map<string, NoteMeta>,
): BacklinkSource[] {
    if (!bucket || bucket.length === 0) return [];
    const sources = bucket.map(({note, links}) => {
        const fresh = notesById?.get(note.id) ?? note; // live meta when available (else the cached ref)
        const body = corpus.get(note.id) ?? '';
        return {note: fresh, contexts: links.map((link) => backlinkSnippet(body, link))};
    });
    sortBacklinkSources(sources);
    return sources;
}

/**
 * Invert the whole link graph in one pass: `targetId → the notes that link to it` (each with the
 * context around every such link), buckets pre-sorted. The eager, snippet-building form kept for
 * direct/test callers; the hot path (`useBacklinks`) uses {@link buildBacklinkInversion} +
 * {@link materializeBacklinks} so only the viewed bucket pays for snippets.
 *
 * `linksById` is an optional precomputed index of `id → extractWikiLinks(body)`. When the caller keeps
 * a warm corpus (see `useCorpus`), pass it so each note's links aren't re-extracted with the link
 * regex. Omit it and links are extracted on the fly, so direct callers/tests still work.
 */
export function buildBacklinkIndex(
    notes: NoteMeta[],
    corpus: Map<string, string>,
    linksById?: Map<string, WikiLinkRef[]>,
): Map<string, BacklinkSource[]> {
    const inversion = buildBacklinkInversion(
        notes,
        linksById ?? new Map([...corpus].map(([id, body]) => [id, extractWikiLinks(body)])),
    );
    const map = new Map<string, BacklinkSource[]>();
    for (const [target, bucket] of inversion) map.set(target, materializeBacklinks(bucket, corpus));
    return map;
}

/**
 * Every note (other than the target itself) whose body links to `targetId` via a `[[wiki link]]`,
 * with the context around each link. Ordered most-recently-updated first, then by title, then id.
 * A thin lookup over {@link buildBacklinkIndex}; on the hot path (open after open) callers should keep
 * the index memoized across switches and look up directly, rather than rebuilding it here per target.
 */
export function buildBacklinks(
    targetId: string,
    notes: NoteMeta[],
    corpus: Map<string, string>,
    linksById?: Map<string, WikiLinkRef[]>,
): BacklinkSource[] {
    return buildBacklinkIndex(notes, corpus, linksById).get(targetId) ?? [];
}
