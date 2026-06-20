# Remove Tabs + nvALT Navigation — Design

- **Date:** 2026-06-20
- **Status:** Approved (not yet implemented)
- **Sub-project:** Course-correction + net-new UX. Reverses the just-merged **Multi-tab Editing**
  feature and steers the app toward a Notational Velocity / nvALT single-pane model. First slice of the
  README's new direction; sequenced after Multi-tab Editing.

## Context

Multi-tab Editing shipped last session: `useNotes` was generalized to per-id collections
(`openNotes` / `saveStates` / `conflicts` + per-id `pending` / `baseline` / `timer` refs) keyed off
`metadata.open[]` / `metadata.active`, a `TabBar` strip was added, and `Workspace` renders one mounted
`EditorPane` per open tab (inactive ones hidden).

The user's feedback (README TODO) reverses course: tabs were a mistake — the sidebar list already
covers "many notes," and the intended direction is a keyboard-first **nvALT / Notational Velocity**
app: one note in view, arrow through the list to preview, type to search, `Esc` to step back out.

The multi-tab work is **local-only** (`main` is 14 commits ahead of `origin`, never pushed), so
reversing direction now is cheap. We do it as a **forward change** (a normal "remove tabs" commit), not
a history rewrite: the tab commits are interleaved with general improvements worth keeping (the pure
metadata helpers, `EditorPane` hardening, per-note conflict logic), and rewriting public-shaped history
buys nothing here.

Two seams already exist and are reused:

- **The per-folder dotfile** (`.gravity-notes.json`, `readMetadata` / `writeMetadata`) persists
  non-note UI state (sort, pins, created stamps, and `active`). The single open note lives here too.
- **`NoteList` already has** roving-`tabIndex` ↑/↓ selection, `Enter`, `F2`, and per-item `itemRefs`;
  **`useShortcuts` already has** a global key layer with a typing-target guard. The nvALT flow extends
  these rather than inventing a new input system.

The conceptual heart of the change is decoupling **"the editor shows a note"** from **"the editor is
focused."** Today `EditorPane` autofocuses whenever it is the active pane. nvALT needs a _browse_ state
(focus in the list, editor merely previewing) distinct from an _edit_ state (focus in the editor).

## Goal

Remove the multi-tab UI and data model — **one note open at a time** — and add a keyboard-first
browse/edit flow: arrow through the list to **live-preview** notes, `Enter` to edit, `Esc` to step back
out (editor → list → closed). No regressions to autosave, save-on-close, conflict handling, search,
sort, pinning, rename, delete, or list a11y. No mutation of `.md` files.

### Success criteria

- **No tabs anywhere.** The editor shows exactly one note (the _active_ note) or the placeholder.
- The **active note persists** in `.gravity-notes.json` (`active`; `open[]` is gone) and is **restored
  as a preview on reload**.
- **Live preview:** moving the list highlight (↑/↓ or click a row) shows that note in the editor with a
  **~150 ms debounced** load; focus stays in the list. Holding the arrow stays smooth — only the note
  the cursor settles on loads.
- **`Enter`** (or clicking into the editor) moves the cursor into the editor to edit. **`Esc` in the
  editor** returns focus to the active note's list row (the note stays shown). **`Esc` again** closes
  the note (placeholder; focus moves to the search box).
- **↓ / ↑ from the search box** jumps focus into the list.
- **Switching notes never loses edits:** the outgoing note's pending edits flush before the swap.
- Autosave, save-on-close (`beforeunload` / `visibilitychange`), and external-edit conflict detection
  all work for the single open note.
- No regressions to search, sort, pinning, rename, delete, or list keyboard a11y.

## Decisions (with rationale)

- **Forward removal, not a revert.** The tab commits are unpushed but interleaved with keepers;
  re-deriving "remove tabs" as a clean change is simpler and safer than unwinding 14 commits of history.
- **Collapse `useNotes` to the proven pre-multi-tab single-note shape** (restore the structure from
  before commit `518546f`, then re-layer the nav). Lower risk than hand-removing the per-id maps from
  the current hook; the single-note autosave/conflict logic is already battle-tested from PR #2.
- **Keep `metadata.active` as the single open note; drop `open[]`.** Restoring the last note on reload
  is a real nicety, the dotfile already exists, and the edit is additive/tolerant (`parseMetadata`
  coerces; schema stays `version: 1`).
- **Unify selection and the open note (live preview); make _focus_ the only browse/edit signal.** The
  note shown never diverges from the list highlight — the simplest mental model and the defining
  Notational Velocity behavior the user asked for.
- **A dedicated `useNoteNavigation` hook** owns the list cursor + preview debounce + focus transitions,
  keeping `useNotes` about storage and `Workspace` thin, and making the flow unit-testable.
- **Single-click a row = preview** (mirrors arrows; focus stays in the list); **`Enter` / click into the
  editor = edit.** Consistent browse-vs-commit model across mouse and keyboard. Double-click stays
  rename.
- **`Esc` on a focused list row closes the note and moves focus to the search box.** This keeps the
  invariant **"a focused list row ⇒ that note is the active preview"** clean: after closing, focus is in
  search (no row focused ⇒ nothing previewed), so "closed" sticks until the user re-enters the list.
- **150 ms preview debounce** — long enough to absorb held-arrow scrolling, short enough to feel live.

## Detailed design

### Data model — `.gravity-notes.json`

`NotesMetadata` loses `open`; `active` is repurposed as _the single open / last-open note_ (schema
stays `version: 1`; old dotfiles' stray `open` is ignored on parse):

```ts
export interface NotesMetadata {
  version: 1;
  sort: SortMode;
  pinned: readonly string[];
  created: Readonly<Record<string, number>>;
  /** The single open / last-open note id, or null when none is open. Restored on reload. */
  active: string | null;
}
```

`DEFAULT_METADATA` drops `open`. `parseMetadata` reads `active` directly (a string or `null`) **without**
the old clamp-into-`open` step.

### Pure metadata layer (`src/storage/metadata.ts`)

- **Remove** `withOpened` and `withClosed` (and the right/left neighbor-activation logic).
- `withActive(meta, id | null)` — set `active` (passing `null` means "closed"); no `open` membership to
  check anymore.
- `reconcile(meta, liveIds)` — `active = liveIds.has(active) ? active : null` (no `open[0]` fallback).
- `withRenamed(meta, oldId, newId)` — remap `active` only (drop the `open` remap).
- `withRemoved(meta, id)` — if `id === active`, set `active = null` (the nav layer picks a neighbor to
  re-preview — see below); drop the `withClosed` call.

### Hook layer — `useNotes` (single note)

Collapses back to single-note state: `note: Note | null`, one `saveState`, one `conflict`; refs
`pendingRef` (`string | undefined`), `baselineRef` (`number | null`), `timerRef`. `activeId` is derived
from `metadata.active` (single source of truth; mutations go through `persistMetadata(withActive(…))`).

| Multi-tab today                           | Becomes                           |
| ----------------------------------------- | --------------------------------- |
| `openIds[]` + `activeId`                  | `activeId: string \| null`        |
| `openNotes: Map`                          | `note: Note \| null`              |
| `saveStates: Map` / `conflicts: Map`      | `saveState` / `conflict`          |
| `pending` / `baseline` / `timer` maps     | single refs                       |
| `open(id)` / `activate(id)` / `close(id)` | `open(id, {focus})` / `close()`   |
| `edit(id, content)`                       | `edit(content)` (implicit active) |

API:

- `open(id, {focus})` — **flush the outgoing active note first** (data safety: the old pane unmounts),
  then `store.get(id)` → set `note`, seed `baseline`, `persistMetadata(withActive(meta, id))`. `focus`
  surfaces to the component as the editor's autofocus intent (true = edit, false = preview).
- `close()` — flush, clear `note` + refs, `persistMetadata(withActive(meta, null))`.
- `edit(content)` — writes `pending`, sets `saveState = 'saving'`, debounces `flush()`. (Same logic as
  PR #2's single-note autosave.)
- `create` — `store.create` + `open(id, {focus: true})`.
- `rename(id, title)` — flush; rename; if the id changed, remap `active` (`withRenamed`) and reload the
  note under its new id so the editor remounts cleanly.
- `remove(id)` — delete + `refresh`; if `id === active`, the delete flow hands off to the nav layer,
  which previews the **next** note in the current ordered list (or the **previous** if the deleted note
  was last, or shows the placeholder if the folder is now empty). The neighbor is computed from the
  ordered list _before_ removal.
- `reloadDisk` / `keepMine` / `saveAsCopy` / `discard` — act on the active note (unchanged single-note
  conflict semantics from PR #2).
- **Restore on load:** load `metadata.active` (if any) into `note`; a missing file → `active = null` and
  the dotfile self-heals. Focus is the component's job (the search box — see cold start).
- **Global concerns** collapse to the one note: `beforeunload` / `visibilitychange` flush it (warn if
  pending/conflict); the focus/visibility check `stat()`s the active note for external edits.

**Conflict-while-navigating-away edge (deliberate):** switching notes flushes the outgoing note; an
_unresolved external conflict_ that the user abandons by navigating away can drop that note's unsaved
local edits — the same behavior as before tabs existed. Rare, and the conflict banner is prominent; the
non-conflict path is fully covered by flush-before-swap.

### Navigation hook — `useNoteNavigation` (new)

Owns the keyboard-first browse/edit flow, decoupled from storage.

- **Inputs:** the ordered note ids (for neighbor math), `activeId`, `open` / `close` from `useNotes`,
  and refs to the editor (`focus()`) and the list (`focusSelected()`).
- **State:** `selectedId` (the list cursor — updates _instantly_, drives the row highlight), a debounce
  timer, and an `editorAutofocus` flag (passed to `EditorPane`).
- **Behavior:**
  - `browse(id)` (arrow / single-click): `setSelectedId(id)` immediately; **debounced (150 ms)**
    `open(id, {focus: false})`; focus stays on the list row; `editorAutofocus = false`.
  - `commit(id)` (`Enter` / click into the editor): cancel the debounce; if `id === activeId`,
    `editorRef.focus()`; else `open(id, {focus: true})`. `editorAutofocus = true`.
  - `escapeEditor()`: blur the editor → `listRef.focusSelected()` (focus the active row; back to
    browse).
  - `escapeList()`: `close()` → `active = null` → focus the **search box**.
  - `enterListFromSearch(dir)`: focus the currently-selected row if there is one, else the **first** row
    on ↓ / the **last** row on ↑ — which previews it.

**Invariant:** a focused list row ⇒ that note is the active preview; focus in the search box or editor ⇒
no list-driven preview. During the 150 ms debounce the highlight (`selectedId`) leads and the editor
(`activeId`) catches up — the expected "live preview loading" feel.

### Component layer (`src/components/`)

- **`EditorPane`** — drop "autofocus when active." Gain `autofocus={editorAutofocus}` (focus only on a
  _commit_ mount) and an `onEscape` prop handled on the **bubble** phase, so editor-internal `Esc`
  (slash menus, popups) is consumed first and only an otherwise-unhandled `Esc` exits to the list.
  `EditorPaneHandle` gains `focus()`. `onChange` → `notes.edit(content)`.
- **`NoteList`** — presentational around `selectedId`: click a row → `onBrowse(id)`; `Enter` →
  `onCommit(id)`; `Esc` → `onEscapeList`; ↑/↓ → `onBrowse(neighbor)`; double-click → rename (kept); `F2`
  → rename (kept). Search box: ↓/↑ → `onEnterListFromSearch`; `Esc` → clear query (existing). Exposes
  `focusSelected()` via an imperative handle.
- **`Workspace`** — remove `TabBar` and the mounted-pane stack; render **one** `EditorPane` for the
  active note (keyed `` `${id}:${updatedAt}` `` so a disk-reload remounts), or the placeholder when
  `activeId === null`. The conflict banner shows when the active note conflicts. Wire
  `useNoteNavigation` between `NoteList`, `useNotes`, and the editor/list refs. On cold load, focus the
  search box.
- **Delete** `TabBar.tsx`, `TabBar.css`, `TabBar.test.tsx`.

### Shortcuts (`src/shortcuts.ts` + `ShortcutsDialog`)

Update descriptors to match the new flow: `up` / `down` → "Preview previous / next note"; `enter` →
"Edit selected note"; `esc` → "Editor → list, then close (or clear search)". Keep `mod+k` (focus
search), `mod+j` (new note), `mod+/` (toggle WYSIWYG/Markup), `?` (help), `f2` (rename). The `mod+k`
vs. insert-link conflict and `F2`-from-editor are **slice E** (out of scope).

### Data flow

```
arrow / click row    ─▶ nav.browse(id)  ─▶ setSelectedId + 150ms debounce ─▶ open(id,{focus:false}) ─▶ editor previews
Enter / click editor ─▶ nav.commit(id)  ─▶ open(id,{focus:true}) | editorRef.focus()                ─▶ cursor in editor
keystroke            ─▶ edit(content)    ─▶ debounce ─▶ flush ─▶ store.save
Esc in editor        ─▶ nav.escapeEditor ─▶ listRef.focusSelected()        ─▶ focus active row
Esc on row           ─▶ nav.escapeList   ─▶ close() ─▶ active=null         ─▶ placeholder + focus search
reload               ─▶ init effect      ─▶ reconcile + load active        ─▶ preview + focus search
```

### Error handling

Unchanged surface: storage methods throw and `useNotes` translates to `onError` toasts. Conflicts use
the existing `ConflictError` / `NotFoundError` path, now for the single active note. A missing
restored-active note self-heals the dotfile (`active = null`).

## Testing (TDD)

- **`metadata.ts`** (pure): `withActive` (set + `null`), `reconcile` (active `null` fallback),
  `withRenamed` / `withRemoved` (active remap / clear), `parseMetadata` tolerance with no `open`.
- **`useNotes`** (hook, fake store): `open` loads + sets active + flushes the outgoing pending edit;
  `edit` autosaves; restore active on remount; conflict detection + all four resolvers; rename / remove
  of the active note.
- **`useNoteNavigation`** (hook): `browse` debounces the preview; rapid arrowing loads only the settled
  note; `commit` focuses the editor (and does _not_ reload when already active); `escapeEditor` focuses
  the row; `escapeList` closes + focuses search.
- **`NoteList`**: click = browse, `Enter` = commit, `Esc` = escapeList, arrows = browse-neighbor, search
  ↓ enters the list, `focusSelected()` works.
- **`EditorPane`**: autofocus only when `editorAutofocus`; `onEscape` fires on bubble; `focus()` handle.
- **`Workspace`** (integration, fake store): arrowing previews in the editor; `Enter` focuses the
  editor; `Esc` walks editor → row → placeholder; deleting the active note previews a neighbor; cold
  load previews the active note and focuses search.
- Remove the `TabBar` tests.

## Out of scope (YAGNI)

- Visual polish — accent color, line-height, dash bullets, editor padding, hiding the toolbar (**slice
  C**).
- `F2`-from-editor and `⌘K`-vs-insert-link bugs (**slice E**).
- Manual save + crash-recovery buffer (**slice F**).
- A separate lightweight read-only preview view — preview reuses the real (unfocused) editor.
- Restoring cursor/scroll position across reloads; multi-select; drag-reorder.

## Risks & mitigations

- **Editor remount cost while browsing.** Each preview remounts ProseMirror. Mitigation: the 150 ms
  debounce loads only the settled note; notes are small and local. Revisit a lightweight preview view
  only if it proves janky.
- **`Esc` vs. editor-internal `Esc`.** Mitigation: handle `onEscape` on the bubble phase so editor
  menus/popups consume `Esc` first.
- **Focus coordination (editor ↔ row ↔ search).** Mitigation: imperative `focus()` / `focusSelected()`
  handles plus the "focused row ⇒ active preview" invariant; covered by the nav-hook and integration
  tests.
- **Abandoning a conflicted note loses its edits.** Mitigation: matches prior behavior; the banner is
  prominent; flush-before-swap covers the non-conflict path.
- **Dotfile write cadence.** Each settled preview writes `active`. Mitigation: user-paced (you pause
  ≥150 ms per note) — the same cadence as today's tab-switch / sort / pin writes; debounce the write
  only if it proves chatty.

## Implementation order

1. `types.ts` + `metadata.ts`: drop `open`, repurpose `active`, update helpers / `parseMetadata` + tests.
2. `useNotes`: collapse to single-note (restore the proven shape) + flush-on-switch + restore-active +
   tests.
3. `EditorPane`: autofocus-on-commit + `onEscape` (bubble) + `focus()` handle + tests.
4. `useNoteNavigation`: `selectedId` + debounced preview + focus transitions + tests.
5. `NoteList`: browse / commit / escape intents + `focusSelected()` + tests.
6. `Workspace`: drop `TabBar` + stack, single pane + nav wiring + cold-start focus + integration tests;
   delete `TabBar.*`.
7. `shortcuts.ts` / `ShortcutsDialog` descriptors. Manual Chromium smoke. Update `CLAUDE.md` roadmap +
   the README TODO.
