# Core UX & Navigation — Design

- **Date:** 2026-06-20
- **Status:** Approved (pending final spec review)
- **Sub-project:** 3 of 5 in the Gravity Notes improvement roadmap

## Context

Gravity Notes can create, edit, rename, and delete notes, and (as of slice 2) protects against
external-edit data loss. But day-to-day navigation is bare: there is no way to **search** the list,
no **keyboard shortcuts**, and rename is **dialog-only**. The note list (`NoteList.tsx`) also still
carries two a11y shortcuts deferred from slice 1 — a stop-propagation wrapper and a dialog
`autoFocus`, both with inline eslint-disables — and the project has **no component/hook test
infrastructure** yet (jsdom + Testing Library was deliberately deferred to this slice, the first that
needs it).

The original kickoff (`docs/superpowers/handoffs/2026-06-19-core-ux-kickoff.md`) scoped five features
into one slice, including **sort + pinning**. Pin/sort is the only piece that touches the storage
layer — notes are plain `.md` files with no metadata, so persisting pins/sort needs a new mechanism
(frontmatter, a folder dotfile, or `localStorage`) and likely a `NoteStore` change. To keep this PR
focused and isolate that architectural decision, **sort + pin is deferred to its own follow-up slice
(3b).** This slice (3a) is UI-layer only and leaves the `NoteStore` interface untouched.

## Goal

Make the note list fast to navigate: searchable, keyboard-drivable, and rename-in-place — and stand
up the component/hook testing foundation (backfilling slice 2's untested conflict logic).

### Success criteria

- The sidebar has an **inline search field** that filters the list live by title (case-insensitive,
  matched text highlighted). ⌘/Ctrl+K focuses it.
- **Keyboard shortcuts** exist for: focus search, new note, toggle WYSIWYG/markup, move selection
  up/down, open the highlighted note, and open a shortcuts help dialog — discoverable via that `?`
  dialog.
- Notes can be **renamed inline** (double-click / F2 / ⋯ menu; Enter or blur commits, Esc cancels).
- The list has **real keyboard navigation** (roving tabindex, `listbox`/`option` roles); the two
  slice-1 a11y eslint-disables are removed.
- **Component/hook testing** runs under jsdom + Testing Library; new code is covered TDD-first and
  slice 2's conflict hook/UI is backfilled.

## Decisions (with rationale)

| Decision               | Choice                                                       | Rationale                                                                                                                          |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Slice scope            | Defer sort + pin to slice 3b                                 | Pin/sort needs a metadata persistence layer + likely a `NoteStore` change. Isolating it keeps this PR UI-only and reviewable.     |
| Search shape           | Inline sidebar filter; ⌘/Ctrl+K focuses the field           | Always-visible and discoverable; low-risk to build/test. A ⌘K command-palette overlay can come later — here ⌘K just focuses.       |
| Search scope           | Title-only (case-insensitive substring), match-highlighted  | `list()` already carries titles; zero extra I/O, instant. The matcher is written so a body matcher can layer in later.            |
| Shortcut clash policy  | Modifier combos = global + `preventDefault`; bare keys gated | Bare keys (↑/↓/Esc/Enter) only act when focus is outside the editor/inputs; modifier combos act globally. Verified in tests.       |
| Shortcut discoverability | `?` (Shift+/) help dialog only                            | One place to learn the keys; no per-button tooltips. (The search field keeps a `⌘K` placeholder hint — free, standard.)           |
| Inline rename commit   | Enter **or blur** commits; Esc cancels; empty/unchanged no-op | Finder/VSCode-style; least surprising. Reuses the store's title sanitizing + unique-filename collision handling.                 |
| List a11y model        | Roving tabindex over `role="listbox"`/`option`              | Real keyboard nav replaces the stop-propagation hack; removes both slice-1 inline eslint-disables properly.                       |
| Test environments      | Vitest `projects`: node for `*.test.ts`, jsdom for `*.test.tsx` | Keeps pure store tests fast in node; component/hook tests get jsdom. Matches the handoff's per-file-type plan.                 |
| Editor mode toggle     | `EditorPane` exposes `toggleMode()` via imperative ref       | The editor instance lives in `EditorPane`; a ref handle lets the central shortcut hook drive it without lifting the editor out.    |

## Detailed design

The `NoteStore` interface and `FileSystemNoteStore` are **unchanged** this slice. All work is in
hooks and components.

### Hook layer (`src/hooks/`)

**`useNoteSearch.ts` (new)** — pure derivation of the filtered list.

- Signature: `useNoteSearch(notes: NoteMeta[]): {query, setQuery, filteredNotes}`.
- `filteredNotes`: when `query` is empty/whitespace, returns `notes` unchanged; otherwise keeps notes
  whose `title` contains the query (case-insensitive substring), preserving the input order.
- Written so a later body matcher is a localized change: the predicate is a single
  `matches(note, query)` function, title-only today.
- No I/O, no effects — trivially unit-tested.

**`useShortcuts.ts` (new)** — central keyboard handling.

- Signature: `useShortcuts(actions: {focusSearch, createNote, toggleEditorMode, selectPrev,
  selectNext, openHelp})`. Attaches a single `keydown` listener on `document` in an effect.
- Command-modifier shortcuts (`⌘/Ctrl+K`, `⌘/Ctrl+J`, `⌘/Ctrl+/`) match regardless of focus and call
  `event.preventDefault()`.
- Focus-gated shortcuts — selection nav (`ArrowUp`/`ArrowDown`) **and** the help dialog (`?`, i.e.
  `Shift+/`) — only fire when focus is **outside** the editor or a text input, guarded by checking the
  active element (`contentEditable`, `INPUT`/`TEXTAREA`). This keeps arrow keys working as normal text
  navigation and lets users type a literal `?` while editing.
- `selectPrev`/`selectNext` are provided by `Workspace` and computed against `filteredNotes` (see
  below), so navigation follows the visible, filtered order.

`useNotes.ts` is **unchanged** — selection, rename, create, and remove already exist; nav is derived
in `Workspace`.

### Component layer (`src/components/`)

**`NoteList.tsx` (reworked)** — new props: `query`, `onQueryChange`, `searchInputRef`. Internals:

- A Gravity `TextInput` search field at the top (placeholder `Search` with a `⌘K` hint, clearable),
  wired to `query`/`onQueryChange`, with `ref={searchInputRef}` so ⌘K can focus it.
- The list renders `role="listbox"`; each item is `role="option"` with `aria-selected`. Roving
  tabindex: the selected (or first) item is `tabIndex=0`, the rest `-1`; ↑/↓ within the list move
  selection and focus. This **replaces** the stop-propagation wrapper and removes its inline
  eslint-disable.
- Match highlighting: the matched substring in each visible title is wrapped in `<mark>` (a small
  `highlightMatch(title, query)` helper returning React nodes).
- **Inline rename:** local state `editingId`. Entering edit (double-click on the title, `F2` on the
  focused item, or the ⋯ menu's "Rename") swaps the title for a `TextInput` seeded with the current
  title and autofocused. **Enter or blur commits**; **Esc cancels**; empty or unchanged → no-op. On
  commit, calls `onRename(id, next)` (existing path: store sanitizes + uniquifies, hook re-selects).
  The rename **dialog is removed**; the dialog `autoFocus` eslint-disable goes with it.
- The **delete confirmation dialog stays** (destructive action).
- Empty state: "No notes yet…" when there are zero notes; "No notes match …" when a query filters
  everything out.

**`ShortcutsDialog.tsx` (new)** — a Gravity `Dialog` listing all shortcuts grouped (Navigation,
Editing, General), each key rendered with the Gravity `Hotkey` component. Opened by `?` (Shift+/) or a
`?` icon button in the header (so the dialog is reachable by mouse, not only by a shortcut you'd have
to already know); closable via Esc/backdrop. Presentational; open state owned by `Workspace`.

**`EditorPane.tsx` (changed)** — wrapped with `forwardRef`, exposing an imperative handle
`{toggleMode()}` via `useImperativeHandle`. `toggleMode` flips the Gravity editor between `wysiwyg`
and `markup` using the editor instance's mode API. (The editor toolbar already offers mode switching;
the shortcut is additive.)

**`Workspace.tsx` (changed)** — the wiring hub:

- Calls `useNoteSearch(notes.notes)` → passes `query`, `onQueryChange`, `filteredNotes` to
  `NoteList`; holds the `searchInputRef` and an `editorRef` (to `EditorPane`).
- Defines the shortcut actions: `focusSearch` (focus `searchInputRef`), `createNote`
  (`notes.create`), `toggleEditorMode` (`editorRef.current?.toggleMode()`), `selectPrev`/`selectNext`
  (find `selectedId` in `filteredNotes`, clamp, `notes.select(neighbor)`), `openHelp` (open the
  dialog). Passes them to `useShortcuts`.
- Adds a `?` icon button to the header that also opens the help dialog, and renders `ShortcutsDialog`
  with its open state.

### Data flow

```
search input ─▶ onQueryChange ─▶ useNoteSearch ─▶ filteredNotes ─▶ NoteList (render + ↑/↓ target)
⌘K ─▶ focus searchInputRef        ⌘J ─▶ notes.create        ⌘/ ─▶ editorRef.toggleMode()
↑/↓ ─▶ neighbor in filteredNotes ─▶ notes.select        ? ─▶ open ShortcutsDialog
```

Filtering never changes selection or closes the open editor — a note filtered out of the list stays
open in the editor.

### Error handling

Unchanged model: storage errors surface through the existing toaster (`onError` in `Workspace`).
Inline rename uses the existing `notes.rename`, which already toasts on failure. Search and shortcuts
are local/pure and have no new failure modes.

### Testing

**Setup:** add `jsdom`, `@testing-library/react`, `@testing-library/user-event`,
`@testing-library/jest-dom`. Convert `vite.config.ts` to Vitest `projects`: a `node` project
(`environment: 'node'`, `include: ['src/**/*.test.ts']`) and a `dom` project (`environment: 'jsdom'`,
`include: ['src/**/*.test.tsx']`, `setupFiles: ['src/test/setup.ts']`). `src/test/setup.ts` imports
`@testing-library/jest-dom` and registers `afterEach(cleanup)`. CI already runs `npm test`; no
workflow change needed.

**New coverage (tests written first for new code):**

- `useNoteSearch.test.tsx` — empty/whitespace query returns all; case-insensitive substring match;
  no-match → empty; order preserved.
- `useShortcuts.test.tsx` — each combo dispatches its action; bare arrow keys are suppressed when an
  input/editor is focused but active otherwise; modifier combos call `preventDefault`.
- `NoteList.test.tsx` — filter narrows the list and highlights matches; inline rename commit via
  Enter and via blur, cancel via Esc, empty and unchanged are no-ops; keyboard nav (↑/↓ move
  selection, Enter opens); delete confirmation; empty vs no-results states; `listbox`/`option` roles
  present.
- `ShortcutsDialog.test.tsx` — renders all documented shortcuts.

**Backfill (slice 2, flagged high-value in the handoff):**

- `useNotes.test.tsx` — conflict resolvers via `renderHook` + the in-memory fake store:
  `reloadDisk` loads disk content and clears the conflict; `keepMine` overwrites using the disk mtime
  baseline; `saveAsCopy` creates a conflicted copy and selects it; `discard` resets state.
- `ConflictBanner.test.tsx` — renders the three actions and the deleted-on-disk variant.

**Caveat:** the Gravity markdown editor is heavy/unreliable to mount in jsdom, so `EditorPane`'s
`toggleMode` is verified by **mocking `useMarkdownEditor`** and asserting the ref handle calls the
mode API — we do not deep-render the third-party editor.

## Out of scope (YAGNI)

- **Sort + pinning** — deferred to slice 3b (needs a metadata persistence design + likely a
  `NoteStore` change).
- **Full-text / body search** — title-only now; the matcher is structured so body search is an
  isolated future change.
- **⌘K command-palette overlay** — ⌘K only focuses the inline field this slice.
- **Per-button shortcut tooltips** — only the `?` help dialog (plus the search placeholder hint).
- **Deep editor-internals tests** — third-party editor behavior is out of our test scope.

## Risks & mitigations

- **Shortcut clashes** with the browser or markdown editor (e.g. some editors bind ⌘K to "insert
  link") — provisional keys are clash-tested during implementation and adjusted; the spec's policy
  (global modifiers + gated bare keys) is the contract, exact keys are tunable.
- **jsdom + Gravity components** can be finicky to render — mitigated by mocking the heavy editor and
  keeping component tests focused on `NoteList`/dialogs, which are standard uikit components.
- **Roving-tabindex regressions** vs the old click handling — covered by `NoteList` keyboard-nav
  tests.

## Implementation order

1. Testing setup: deps, `vite.config.ts` → `projects`, `src/test/setup.ts`; a trivial smoke test
   green under jsdom.
2. Backfill slice 2: `useNotes` conflict-resolver tests + `ConflictBanner` test (red → green against
   existing code; catches regressions before refactors).
3. `useNoteSearch` (tests → impl).
4. `NoteList` rework: search field + match highlight + `listbox` a11y + inline rename, removing both
   eslint-disables (tests → impl).
5. `useShortcuts` (tests → impl).
6. `EditorPane` ref handle + `ShortcutsDialog`.
7. `Workspace` wiring (search state, refs, shortcut actions, help dialog).
8. Full verification (lint, format:check, typecheck, test, build) + manual smoke of search,
   shortcuts, and inline rename.
