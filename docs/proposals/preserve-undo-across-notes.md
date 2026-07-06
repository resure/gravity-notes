# Proposal: Preserve undo/redo across note switches

Status: **proposed** (not yet implemented) · Backlog item: "Preserve cmd+z between notes"

## Context

Today, switching notes **hard-resets** both undo histories (ProseMirror + CodeMirror) so `⌘Z`
can't walk into the previous note's content. The cost: edit note A, switch to B, come back to A —
`⌘Z` does nothing, A's edit history is gone. This proposal makes per-note undo/redo **survive**
switching away and back, within a session.

The editor (`@gravity-ui/markdown-editor`) is a single reused instance; content is swapped in place
per note. There is **no** public API to serialize/restore history (the `history` plugin instance is
private, so `EditorState.toJSON`/`fromJSON` with plugin fields is a dead end). The workable approach:
**hold each note's live `EditorState` object in memory and restore it wholesale** — history travels
with the object. This is exactly what the current reset already does, just with a *fresh* state:
`view.updateState(EditorState.create({doc, plugins}))` (`EditorPane.tsx`, `resetHistory`). We swap the
fresh state for the saved one.

All changes are contained to `src/components/EditorPane.tsx` (the swap logic), with doc updates.

## Approach

Keep two per-note maps of live editor states (one per mode), save the **active** mode's state when
switching away, and restore it when returning — but only if it's still valid.

### Why active-mode-only

The hidden mode's buffer goes stale between mode toggles (e.g. editing in WYSIWYG leaves the
CodeMirror buffer showing old content until a toggle regenerates it). So its saved state wouldn't
match `editor.getValue()`. Saving/restoring **only the currently-active mode** (`editor.currentMode`)
keeps the stored content in lockstep with the saved doc. The inactive mode keeps today's fresh-reset
behavior (which also re-syncs its hidden buffer to the new content — load-bearing, see the
`resetMarkupHistory` comment in `EditorPane.tsx`).

### Validity guard

A saved state is only restored when its stored `content === note.content` (the incoming, on-disk
content). Pending edits are flushed before `open()`, so on a normal switch-back these match. If the
note changed on disk while away (external edit / conflict reload), they won't — fall back to a fresh
reset so we never restore stale history over new content.

### Memory footprint

A saved `EditorState` is dominated by its immutable document tree (roughly 2–5× the note's text size
in JS object overhead) plus the `history` plugin's stack (`history({depth: 100})` — bounded; small
for normal typing). Typical note → ~20–100 KB; a large 100 KB note → a few hundred KB. Both maps are
**LRU-capped at ~25 notes**, so the worst case (25 huge, heavily-edited notes) is the only place this
grows, and the cap bounds it. The cap value is the effective lever if the footprint needs tuning.

## Changes — `src/components/EditorPane.tsx`

1. **Two LRU-capped ref maps** beside the existing `viewStateByIdRef`:
   - `pmHistByIdRef: Map<string, {state: EditorState; content: string}>`
   - `cmHistByIdRef: Map<string, {state: CmEditorState; content: string}>`
   - Cap ~25 entries each (delete-then-set for LRU ordering; evict oldest past the cap).

2. **Extend `saveViewState(id)`** to also capture the active mode's live state with the current
   content:
   - `wysiwyg` → `pmHistByIdRef.set(id, {state: wikiViewRef.current.state, content: editor.getValue()})`
   - `markup` → `cmHistByIdRef.set(id, {state: markupEditorOf(editor).cm.state, content: editor.getValue()})`

3. **Turn the two resets into restore-or-reset** (return `preserved: boolean`):
   - `resetHistory(id)`: if `currentMode === 'wysiwyg'` and a saved PM entry's
     `content === note.content` → `view.updateState(saved.state)` and return `true`. Else the current
     fresh `EditorState.create({doc, plugins})` path, return `false`.
   - `resetMarkupHistory(id)`: symmetric with `markup.cm.setState(saved.state)` vs the current
     `freshMarkupState(template, note.content)`.

4. **Swap effect**: pass `note.id` into both resets; capture `preserved` from `resetHistory`. A
   restored PM state already carries its own selection, so **skip `restoreSelection`** when preserved
   (calling it would dispatch a redundant `setSelection` — which would pollute the just-restored
   history). Keep it for the fresh path.

5. **Re-key on rename/move**: carry `pmHistByIdRef` / `cmHistByIdRef` entries from the old id to the
   new one, alongside the existing `viewStateByIdRef` re-key.

Reused as-is: `markupEditorOf` / `freshMarkupState` (`editor/markupHistory.ts`), `editor.currentMode`
(already used in `EditorPane.tsx`), the `swappingRef` bracket (updateState/setState run inside it, so
the change handler still treats them as a load echo, not a user edit).

## Docs

- Update the class comment in `EditorPane.tsx` (the "history HARD-RESET" note) and the
  `resetHistory`/`resetMarkupHistory` doc comments to describe restore-or-reset.
- Update `CLAUDE.md` (the EditorPane line stating a note switch "hard-resets BOTH undo histories").

## Verification

**Live (primary), via the preview dev server:**

1. WYSIWYG: type in note A, switch to B, type in B, switch back to A → `⌘Z` undoes A's edits (not
   B's, not nothing); `⌘⇧Z` redoes. Switch to B → `⌘Z` undoes B's. Confirm undo stops at each note's
   loaded state and never crosses into the other note's text.
2. Markup mode (`⌘⇧;`): repeat — history preserved per note there too.
3. Fresh open of a never-visited note → `⌘Z` is a no-op (nothing to undo). Rename a note mid-session,
   switch away and back → history still restores under the new name.

**Tests:** add coverage where deterministic in jsdom — extend the editor-history tests
(`editor/markupHistory.test.ts` is the closest existing harness) and/or add an EditorPane/Workspace
integration test that types in A, switches to B and back, dispatches undo, and asserts A's content
reverts. Full suite (`npm test`), `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Risks & mitigations

- **Restoring a bad/stale state** → guarded by content-match + active-mode checks; any miss falls
  back to today's fresh reset (the existing, safe behavior).
- **Memory growth** → both maps LRU-capped (~25 notes).
- **Cross-mode / conflict-reload edge cases** → the content-match guard makes these fall back to
  fresh reset, matching current behavior.
- This is the app's most delicate code (the swap logic); the fresh-reset paths are left intact as the
  fallback, so the blast radius of a preserve-path bug is "history resets like before," not
  corruption.
