# Next-Session Kickoff — Sort & Pinning (roadmap slice 3b)

A handoff for resuming in a fresh session. Read it together with `CLAUDE.md` and the slice-3a
spec/plan before starting.

## Where things stand (as of 2026-06-20)

- Branch: `main`, clean. Three roadmap slices are merged:
  - **Slice 1 — Code health foundation** (PR #1): Vitest, ESLint, Prettier, CI, storage tests.
  - **Slice 2 — Robustness & data safety** (PR #2): optimistic-concurrency `save`/`stat`/`ConflictError`,
    conflict banner, refocus detection, beforeunload warning.
  - **Slice 3a — Core UX & navigation** (PR #3): title search + match highlight, keyboard shortcuts
    (`useShortcuts`) + `ShortcutsDialog`, inline rename, `listbox`/`option` roving-tabindex a11y, and
    the jsdom + Testing Library foundation (Vitest `projects`: node `*.test.ts`, jsdom `*.test.tsx`).
    **58 tests across 9 files.** Slice-2's conflict resolvers + `ConflictBanner` were backfilled.
- Commands unchanged: `npm run dev | build | preview | test | test:watch | lint | lint:fix | format
| format:check | typecheck`.
- 3a was verified by an automated real-browser smoke (Playwright with an injected in-memory folder),
  covering search, ⌘K/⌘J/⌘‑slash (incl. the real markdown editor mode toggle), the `?` dialog
  (open / gated-while-typing / header button), inline rename, and the ⋯ menu — all green.

### Key architecture touchpoints (current shape after 3a)

- `src/storage/types.ts` — `NoteStore`: `list`, `get`, `create`, `save(id, content, baseUpdatedAt)`,
  `rename`, `remove`, `stat`. **No metadata/index layer** — one note is one `.md` file; the filename
  is the id, the name minus `.md` is the title. `list()` sorts **newest-first by `updatedAt`** (the
  file's `lastModified`), and `useNotes` re-sorts the same way on save (`bumpInList`).
- `src/storage/fileSystemStore.ts` — File System Access implementation; `src/storage/fakeFileSystem.ts`
  — the in-memory test fake (extend it for any new store behavior).
- `src/hooks/useNotes.ts` — note list, selection, debounced autosave, conflict state/resolvers.
- `src/hooks/useNoteSearch.ts` — `useNoteSearch(notes) → {query, setQuery, filteredNotes}` (pure,
  title-only substring; `noteMatches` is the seam for future body search). **Filtering happens after
  ordering** — whatever orders the list feeds `useNoteSearch`.
- `src/hooks/useShortcuts.ts` — one document-level keydown listener; actions `{focusSearch, createNote,
toggleEditorMode, openHelp}`. List ↑/↓ nav lives in `NoteList`, not here.
- `src/components/` — `NoteList` (search field + listbox + inline rename + ⋯ menu + delete dialog),
  `ShortcutsDialog`, `Workspace` (wires `useNoteSearch` → `filteredNotes`, `useShortcuts`, the search
  ref, the editor ref, the `?` header button), `EditorPane` (`forwardRef` + `toggleMode()`),
  `ConflictBanner`.

## This slice's scope

Sort & pinning — the two features deferred out of 3a because they need a **persistence layer the app
doesn't have yet**:

1. **Sort options** for the note list — e.g. updated / created / title (A→Z) / manual.
2. **Pinning** — keep chosen notes at the top regardless of sort.

This is the slice that **changes the `NoteStore` interface** (kept storage-agnostic). It is the central
architectural decision of the whole roadmap.

## The central decision — where does the metadata live? (resolve via brainstorming; do NOT pre-decide)

Notes are plain `.md` files with no metadata. Pins, the chosen sort mode, and any manual order need a
home. Weigh at least these:

- **YAML frontmatter inside each `.md`** — travels with the note, survives folder moves; but mutates
  files the user "fully owns" as plain markdown (the editor must preserve/hide it), and it's per-note
  (natural for a pin flag, awkward for a global sort mode + manual order).
- **A folder dotfile index** (e.g. `.gravity-notes.json`) — one sidecar holding `{pinned: id[], sort,
order?}`; travels with the folder (Dropbox/iCloud), doesn't touch note bodies; but adds a file to
  the folder and needs its own external-change handling (the same TOCTOU/conflict concerns as notes).
- **`localStorage` keyed by folder** — simplest, touches no files; but doesn't sync across
  machines/browsers and isn't tied to the folder's identity reliably.

A mix is possible (e.g. pins in frontmatter, sort-mode in localStorage). Lead the brainstorm with the
trade-offs and a recommendation.

## Other open design questions

- **"Created" time isn't available.** The File System Access API exposes only `lastModified` (no
  birthtime). Sorting by created date requires storing a created timestamp in the new metadata layer —
  decide whether "created" is in scope or dropped.
- **Manual ordering** means drag-and-drop reorder + persisted order — a real UI lift. In or out for 3b?
- **Where does ordering compute?** Today it's hardcoded (`list()` + `bumpInList`). With pins + sort it
  becomes `order(notes, {pinned, sortMode, manualOrder})` — likely a new pure hook (e.g.
  `useNoteOrder`) feeding `useNoteSearch`. Keep store ordering vs. UI ordering responsibilities clear.
- **Pin/sort UI** — a sort control in the sidebar header; a pin affordance (⋯ menu item? hover icon?);
  a visual treatment for pinned notes (separate section vs. inline pin glyph). These are visual — the
  brainstorming visual companion is worth using here.
- **Interactions** — does sort/pin apply while searching (yes, order the base list, then filter)?
  Roving-tabindex/`focusableId` and the ⌘K/↑↓ flows must keep working over the reordered list.

## Carry-over polish from 3a reviews (fold into 3b or a cleanup)

- **`ShortcutsDialog` label drift.** The dialog's `GROUPS` table is hand-maintained and duplicates the
  real bindings (`useShortcuts` + `NoteList`). All entries are currently accurate, but there's no test
  linking them. Consider deriving the dialog rows from a shared shortcut descriptor, or add a test that
  fails on divergence.
- **Help-dialog completeness.** Enter/Space-to-open and Esc-to-clear-search aren't listed in the help
  sheet. Add them if a new shortcut row is touched anyway.

## Process to follow in the fresh session

1. Read this doc, `CLAUDE.md`, and `docs/superpowers/specs/2026-06-20-core-ux-navigation-design.md`.
2. Invoke **superpowers:brainstorming** → resolve the metadata-home decision + the open questions with
   the user (use the visual companion for the sort/pin UI) → write the spec to
   `docs/superpowers/specs/YYYY-MM-DD-sort-pinning-design.md` and commit.
3. Invoke **superpowers:writing-plans** → bite-sized TDD plan in `docs/superpowers/plans/`.
4. Create a feature branch (e.g. `sort-pinning`) **from an up-to-date `origin/main`** (note: in 3a the
   spec/plan were committed to local `main` before branching, which made local `main` diverge from the
   squash-merged remote and needed a `git reset --hard origin/main` to reconcile — branch _after_
   committing docs, or commit docs on the branch, to avoid that).
5. Execute with **superpowers:subagent-driven-development** (fresh subagent per task + spec/quality
   review each); commit per task.
6. Verify `lint && format:check && typecheck && test && build`, push, open a PR, confirm CI green, then
   **superpowers:finishing-a-development-branch**. Squash-merge (the repo's house style).

## Conventions reminder

4-space indent + single quotes (Gravity Prettier); ESLint enforces formatting on JS/TS; **Prettier
also checks `.md`** (run `npm run format` on new docs before committing — `format:check` is in CI);
automatic JSX runtime (no React import); `void promise()` marks intentional unawaited promises; errors
surface through the toaster (`onError` in `Workspace`); keep all persistence behind the `NoteStore`
seam — even the new metadata layer.

## Pointers

- Specs: `…/specs/2026-06-19-code-health-foundation-design.md`,
  `…-robustness-data-safety-design.md`, `…/specs/2026-06-20-core-ux-navigation-design.md`.
- Plans: `…/plans/2026-06-19-*`, `…/plans/2026-06-20-core-ux-navigation.md`.
- Merged PRs: #1 (code health), #2 (robustness), #3 (core UX 3a).
