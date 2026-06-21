# In-Editor Note Title Field — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** Net-new editing UX on the `remove-tabs-nvalt` branch. Surfaces the note **title** as a
  first-class, editable field at the top of the open-note surface (Obsidian/Apple-Notes style), where the
  title _is_ the file name. Sequenced after the nvALT navigation and UX-polish slices.

## Context

In Gravity Notes the title and body are **already separate in the data model**: one note = one `.md`
file, the file name (minus `.md`) is the title, the file contents are the body
(`FileSystemNoteStore`, `NoteMeta.title` / `Note.content`). What's missing is a way to **see and edit
the title from the editor**. Today the title is only shown/edited in the sidebar list — via inline
rename (double-click / `F2` / the row's "Rename" menu item) — and the editor pane shows the body alone.

Relevant facts the design builds on:

- **Renaming changes the id.** The id _is_ the file name (`Ideas.md`); `FileSystemNoteStore.rename`
  sanitizes the title, copy-then-deletes (the FS Access API has no atomic rename), and returns a meta
  whose `id` differs from the old one. On a collision it is currently a **silent no-op** (returns the
  old meta).
- **The body editor is recreated when the id changes.** `Workspace` keys `EditorPane` by
  `` `${note.id}:${note.updatedAt}` ``, and `EditorPane` calls `useMarkdownEditor(…, [note.id])`. So a
  rename today tears down and rebuilds the ProseMirror editor.
- **The editor exposes exactly the cursor primitives we need:** `editor.focus()`,
  `editor.moveCursor('start' | 'end')`, `editor.hasFocus()`, `editor.currentMode`, and `editor.dom`
  (`MarkdownEditorInstance`).
- **Autosave is decoupled from React state** and debounced 500 ms (`useNotes`): keystrokes flow into a
  ref + timer, never `setState`, so the editor instance is never recreated mid-typing. `rename` already
  `flush()`es pending edits before renaming.
- **Navigation is keyboard-first** (`useNoteNavigation`): the list cursor previews a note in the editor
  without stealing focus; `Enter` commits to editing; an `Esc` ladder walks focus back
  (editor → list → search).

The conceptual heart of this change: **make the title an editable surface whose edits rename the file,
without that rename disrupting the body editor.**

## Goal

Add a single-line **title field** at the top of the open-note surface that displays the file name
(minus `.md`) and renames the file when edited. Cursor movement between the title and the body must feel
native. No regressions to autosave, save-on-close, conflict handling, search, sort, pinning, list
rename, delete, or list a11y.

### Success criteria

- An open note shows an editable **title** above its body, styled between an h1 and an h2, aligned to
  the body's left edge, with an "Untitled" placeholder when empty.
- **Editing the title renames the file** (and its sidebar row) when the title is _left_ — moving into
  the body, clicking away, or switching notes — **or on `Enter`**. The title is _not_ renamed on every
  keystroke.
- **Cursor handoff feels native:**
  - **Title → body:** `Enter` or `↓` moves the caret to the **start of the body**.
  - **Body → title:** `↑` while the caret is on the **first visual line** of the body moves it to the
    **end of the title**.
- **A rename never remounts the body editor** — the caret/selection you just moved into the body
  survives the id change; no flash, no content reload.
- **Creating a note focuses the title** with "Untitled" selected, so you can name it and press `↓` /
  `Enter` into the body.
- **Collisions are surfaced:** renaming onto an existing note's name reverts the title and shows a
  toast (instead of silently doing nothing).
- The existing list rename surfaces (`F2`, double-click, the row menu) keep working and share the same
  `rename` path.
- No mutation of `.md` bodies beyond the existing autosave; no change to `.gravity-notes.json` schema.

## Decisions (with rationale)

- **Commit the rename on _leaving_ the title (blur) or `Enter`; never per keystroke.** Each rename is a
  copy-then-delete that changes the id — heavyweight and disruptive to do live. Committing at a natural
  boundary (the user's chosen model) keeps renames to one per editing session and matches Obsidian.
  `onBlur` is the single commit path; `Enter`/`↓` move focus to the body, which blurs the title and thus
  commits.
- **Decouple the body editor's lifecycle from the file name via a stable `sessionId`.** `useNotes`
  exposes a monotonic `sessionId` that bumps only when fresh content is loaded into the editor (`open`,
  `reloadDisk`, initial restore) — **not** on rename. `Workspace` keys `EditorPane` by `sessionId`, and
  `EditorPane` creates its editor once per mount (`useMarkdownEditor(…, [])`). A rename then updates
  `note.id` / `note.title` / the save baseline **in place** with no remount. Rejected alternative:
  keep the id-based key and accept the remount — it flashes the editor and drops the caret exactly
  during the title→body handoff we're trying to make seamless.
- **Put the title _inside_ `EditorPane`.** EditorPane becomes "the open-note surface: title + body," so
  the title↔body cursor handoff is internal (the same component holds both the title input and the
  `editor` instance) — no cross-component focus refs. A small `NoteTitle` child owns the input + draft.
- **Caret-rect detection for "first visual line."** `↑`-to-title fires when the DOM selection's client
  rect sits on the topmost line of the body content. This is mode-agnostic (works for both the
  WYSIWYG/ProseMirror and Markup/CodeMirror contenteditables) — simpler and more robust than reaching
  into ProseMirror/CodeMirror internals per mode.
- **Single-line title (no wrapping) for v1.** Keeps the cursor logic to a single boundary check (only
  the _body's_ first line matters; `↓`/`Enter` always leave the title). Long titles scroll horizontally.
  Wrapping/multi-line titles are a later enhancement.
- **Pin the title above the body's scroll** (always visible on long notes), rather than scrolling it
  away with the body. The Gravity editor owns its own scroll container; a pinned header avoids fighting
  that and keeps the note's identity on screen. Scroll-with-body is a possible later refinement.
- **Make `store.rename` throw on a real collision** (target file exists) instead of a silent no-op, so
  both the title field and the list rename can tell the user. A genuine no-op (sanitized name equals the
  current name) still returns quietly.

## Detailed design

### Storage layer (`src/storage/`)

- **`FileSystemNoteStore.rename`** — distinguish three cases:
  - sanitized `nextName === id` → return the current meta (genuine no-op, no error).
  - target exists (different file) → **throw `NameCollisionError`** (new error type in `types.ts`).
  - otherwise copy-then-delete as today, and return a meta whose `updatedAt` is the **real**
    `lastModified` of the new file (read it back), not `Date.now()` — so the caller seeds an accurate
    conflict baseline.
- **`types.ts`** — add `NameCollisionError extends Error` (carries `id` + attempted `name`); document
  that `rename` throws it. The `NoteStore` interface contract note is updated accordingly.

### Hook layer — `useNotes` (`src/hooks/useNotes.ts`)

- **Add `sessionId: number`** to `UseNotes`. Internal `sessionRef` + state; a `bumpSession()` helper
  increments it. Bump on: the initial restore of an active note, `open`, and `reloadDisk`. **Do not**
  bump on `rename`, `save`/`flush`, `keepMine`, `togglePin`, etc.
- **`rename`** — keep `flush()` first. Then `store.rename`:
  - On `NameCollisionError`: surface via `onError` and **return `null`** (the title field reverts its
    draft; the list path re-selects the old id). Pending edits are untouched.
  - On success with a changed id: `persistMetadata(withRenamed(meta, id, newId))`, set
    `baselineRef = meta.updatedAt`, and update `note` **in place**
    (`setNote(prev => prev?.id === id ? {…prev, id, title, updatedAt} : prev)`) **without** bumping
    `sessionId` → no remount. `refresh()` the list. Return `newId`.
  - The content is unchanged by a rename, so there's no `store.get` reload.
- **Race safety:** `Enter`/`↓` focus the body _immediately_ (instant caret jump); the rename runs in the
  background off the title's `onBlur`. Between firing that rename and `withRenamed` remapping `active`, a
  body keystroke would tag its pending edit with the _old_ id — but this can't bite in practice: autosave
  is debounced 500 ms and a local-FS rename resolves in a few ms, so `active` is the new id long before
  any flush. (And `rename` `flush()`es first, so any pending body edit is saved to the old file before
  the copy.)
- Everything else (autosave, conflict detection + the four resolvers, restore-on-load, save-on-close)
  is unchanged; they key off `active` + `baselineRef`, not the `note` object identity.

### Navigation hook — `useNoteNavigation` (`src/hooks/useNoteNavigation.ts`)

- Generalize the next-mount focus intent from `editorAutofocus: boolean` to
  **`autofocus: 'body' | 'title' | null`**:
  - `browse` → `null` (preview, no focus steal).
  - `commit` → `'body'` (edit the note).
  - new **`prepareCreate()`** → `'title'` (used before creating a note).
- The old `prepareCommit()` (which armed body autofocus before a create) is removed; `handleCreate` now
  calls `prepareCreate()` so a new note mounts with the title focused.

### Component layer (`src/components/`)

- **`NoteTitle` (new)** — a controlled single-line input that _looks_ like a heading.
  - Props: `title` (the committed title), `placeholder` (`"Untitled"`), `readOnly`,
    `onCommit(nextTitle)`, `onLeaveToBody()`, `onEscape()`. Exposes `focus()`, `focusAtEnd()`,
    `select()` via an imperative handle.
  - Local `draft` state, seeded from `title` at mount. Syncs to `title` when the prop changes _and_ the
    field isn't focused (so a commit's sanitized result, e.g. `a/b` → `a b`, lands in the field).
  - `onBlur` → `onCommit(draft)` (the single rename trigger). `Enter` / `↓` → `onLeaveToBody()` (which
    focuses the body and so blurs the input, routing the commit through `onBlur`). `Esc` → revert
    `draft` to `title`, then `onEscape()`.
  - Commits its `draft` on **unmount** if still dirty (`draft !== title`) — a safety net for programmatic
    note switches that never blur the field. A duplicate commit is a harmless store no-op (the file is
    already at that name).
- **`EditorPane`** — becomes the title + body surface.
  - Renders `<NoteTitle>` above either the `MarkdownEditorView` or the `NotePreview`. In preview mode the
    title is `readOnly`.
  - `useMarkdownEditor(…, [])` (create once per mount; `sessionId` keying handles remounts).
  - New props: `onRename(nextTitle)` (→ `NoteTitle.onCommit`) and `autofocus: 'body' | 'title' | null`.
  - Cursor handoff:
    - title → body: `NoteTitle.onLeaveToBody` = `() => { editor.moveCursor('start'); editor.focus(); }`.
    - body → title: a keydown listener on the editor pane; on `ArrowUp` (no modifiers), if the current
      selection's caret rect is on the body's first visual line, `preventDefault()` and
      `titleRef.focusAtEnd()`.
  - On (re)mount: `autofocus === 'title'` → focus + select the title; `autofocus === 'body'` → focus the
    body (existing behavior); `null` → no focus. (The unmount-commit safety net lives in `NoteTitle`.)
- **`Workspace`** — key `EditorPane` by `notes.sessionId`. Wire `onRename={(t) => handleEditorRename(t)}`
  where `handleEditorRename` calls `notes.rename(note.id, t)` and, on a changed id, points
  `nav.setSelected` at the new id (keeping the list highlight in sync) **without** stealing focus from
  the body. `handleCreate` uses `nav.prepareCreate()`. Pass `autofocus={nav.autofocus}`.

### Styling (`src/components/NoteTitle.css`, `EditorPane.css`)

- Title ~`1.6rem`, weight `600`, line-height ~`1.25`, color `--g-color-text-primary`; placeholder in
  `--g-color-text-secondary`. Borderless, transparent background, no focus ring box (a subtle caret is
  enough). Left padding matched to the body's content padding so title and first body line align; a
  small gap below the title before the body.
- Pinned above the body's scroll region within `.editor-pane`.

### Data flow

```
type in title           ─▶ NoteTitle draft (local)                              ─▶ nothing on disk yet
Enter / ↓ in title      ─▶ onLeaveToBody ─▶ editor.moveCursor('start')+focus    ─▶ caret in body
title blur (any cause)  ─▶ onCommit(draft) ─▶ notes.rename ─▶ store.rename       ─▶ file + row renamed (no remount)
↑ on body's first line  ─▶ editor-pane keydown ─▶ titleRef.focusAtEnd()          ─▶ caret at end of title
new note                ─▶ prepareCreate ('title') ─▶ create+open ─▶ mount       ─▶ title focused + selected
collision               ─▶ store.rename throws ─▶ onError toast ─▶ rename()=null ─▶ draft reverts
```

### Error handling

Unchanged surface: storage throws, `useNotes` translates to `onError` toasts. The new
`NameCollisionError` is caught in `rename` and toasted; the title field reverts. Empty/sanitized-empty
titles fall back to "Untitled" in the store as today. Conflict handling for the active note is
unchanged.

## Testing (TDD)

- **`fileSystemStore` (`*.test.ts`):** `rename` throws `NameCollisionError` when the target exists;
  returns the current meta unchanged when the sanitized name equals the current name; returns the new
  file's real `lastModified` on success.
- **`useNotes` (hook, fake store):** a rename updates `note.id`/`title`/baseline **without** bumping
  `sessionId`; `open` / `reloadDisk` / restore **do** bump it; a collision toasts and returns `null` and
  leaves `active`/pending intact; autosave still targets the renamed id.
- **`NoteTitle`:** `onBlur` commits the draft; `Enter` and `↓` call `onLeaveToBody`; `Esc` reverts +
  escapes; the draft syncs to a changed `title` prop only while unfocused; `readOnly` blocks edits.
- **`EditorPane`:** `Enter`/`↓` in the title puts the caret at the body start; `↑` on the first body
  line focuses the title at its end (and does _not_ when the caret is lower); `autofocus='title'`
  focuses+selects the title on mount; a rename does not recreate the editor.
- **`Workspace` (integration, fake store):** type a title then switch notes → file renamed and the row
  updates; the body editor keeps its content/caret across a rename; creating a note lands focus in the
  title; the cursor walks title↔body via the keys above.

## Out of scope (YAGNI)

- Multi-line / wrapping titles; `Tab` as a handoff key; `→`-at-end / `Backspace`-at-start gestures.
- Stripping a leading `# H1` out of existing bodies into the title (the title is purely the file name).
- Scroll-the-title-away-with-the-body behavior.
- Live (per-keystroke / debounced) renaming.
- Changing the list's inline-rename UI (it stays; it just shares the new error path).

## Risks & mitigations

- **"First visual line" detection across editor modes.** Mitigation: a DOM caret-rect check (selection
  rect vs. content top) rather than mode-specific internals; covered by `EditorPane` tests and a
  Chromium smoke test in both WYSIWYG and Markup modes.
- **Editing during an in-flight rename (old-id pending edit).** Mitigation: the 500 ms autosave debounce
  vastly exceeds a local-FS rename, so `active` is remapped to the new id well before any flush could
  fire; `rename` also `flush()`es pending edits to the old file before the copy.
- **Draft ↔ committed-title divergence after sanitizing.** Mitigation: `NoteTitle` syncs `draft` to the
  `title` prop whenever it changes while the field is unfocused.
- **`sessionId` keying regressions** (a flow that should remount but no longer does, or vice-versa).
  Mitigation: explicit hook tests asserting which operations bump `sessionId`; the disk-reload/conflict
  remount paths bump it deliberately.

## Implementation order

1. `types.ts` + `fileSystemStore.ts`: `NameCollisionError`, `rename` collision-throw + real `updatedAt`;
   tests.
2. `useNotes`: `sessionId` (+ bump points), in-place rename, collision handling; tests.
3. `useNoteNavigation`: `autofocus: 'body' | 'title' | null` + `prepareCreate`; tests.
4. `NoteTitle` (new) + CSS; tests.
5. `EditorPane`: mount the title, `[]` editor deps, cursor handoff, mount-focus, unmount commit; tests.
6. `Workspace`: `sessionId` key, `onRename` wiring, `prepareCreate` on create, `autofocus` prop;
   integration tests.
7. Help-dialog/shortcut copy touch-ups (mention title editing + `↑`/`↓`/`Enter` handoff). Chromium
   smoke test. Update `CLAUDE.md` roadmap + the README.
```