# Next-Session Kickoff — Core UX & Navigation (roadmap slice 3)

This is a handoff note for resuming work in a fresh session. Read it together with
`CLAUDE.md` and the two prior specs/plans before starting.

## Where things stand (as of 2026-06-19)

- Branch: `main`, clean. Two roadmap slices are merged:
  - **Slice 1 — Code health foundation** (PR #1): Vitest, ESLint (Gravity flat config), Prettier, GitHub Actions CI, and 13 storage tests via an in-memory File System Access fake.
  - **Slice 2 — Robustness & data safety** (PR #2): optimistic-concurrency `save` + `stat` + `ConflictError`, a non-blocking conflict banner (reload / keep-mine / save-as-copy), proactive refocus detection, and a beforeunload unsaved-changes warning. 19 store tests total.
- Commands: `npm run dev | build | preview | test | test:watch | lint | lint:fix | format | format:check | typecheck`.
- **No component/hook tests exist yet** — jsdom + Testing Library was deliberately deferred to _this_ slice (it's the first one that needs it).

### Key architecture touchpoints

- `src/storage/types.ts` — `NoteStore` interface. Current shape: `list`, `get`, `create`, `save(id, content, baseUpdatedAt) => NoteMeta` (throws `ConflictError`), `rename`, `remove`, `stat(id) => number | null`. No metadata/index store — one note is one `.md` file; the filename is the id, the filename minus `.md` is the title.
- `src/storage/fileSystemStore.ts` — the File System Access implementation; `src/storage/fakeFileSystem.ts` — the in-memory test fake (extend it for new store behavior).
- `src/hooks/useNotes.ts` — note list, selection, debounced autosave (decoupled from React state via refs), conflict state + resolvers. This is where search/sort/shortcuts state will mostly live.
- `src/components/` — `FolderGate`, `Workspace` (header + layout), `NoteList` (sidebar: create/rename/delete), `EditorPane` (Gravity markdown editor, keyed by `id:updatedAt`), `ConflictBanner`.

## This slice's scope

Core UX & navigation — the day-to-day features that are missing:

1. **Search / filter** the note list.
2. **Keyboard shortcuts** (new note, switch notes, toggle WYSIWYG/markup, focus search, …).
3. **Sort options + pinning** of notes.
4. **Inline rename** (today rename is dialog-only in `NoteList`).
5. **Stand up component/hook testing** (jsdom + `@testing-library/react`) — and backfill tests for slice 2's conflict hook/UI while we're at it.
6. **Revisit the deferred `NoteList` a11y items** from slice 1 (the stop-propagation wrapper + dialog autofocus inline-disables) — `NoteList` gets reworked here anyway, so fix them properly with real keyboard nav.

## Open design questions — resolve via brainstorming (do NOT pre-decide)

- **Search:** title-only or full-text (note body)? Live incremental filter in the sidebar vs a command-palette overlay? Highlight matches? (Full-text means reading file bodies — `list()` only carries metadata; perf matters since `list()` already does one `getFile()` per note for mtime.)
- **Keyboard shortcuts:** which bindings, and how to avoid clashing with the markdown editor and the browser? A discoverability affordance (help sheet / tooltips)? Consider a small Gravity `hotkey`/`useHotkeys` approach vs hand-rolled listeners.
- **Sort + pin (the hard one):** sort modes (updated / created / title / manual?). **Where do pins live?** The store is plain `.md` files with no metadata layer. Options to weigh: YAML frontmatter inside each `.md`; a folder dotfile index (e.g. `.gravity-notes.json`); or `localStorage` keyed by folder. This likely touches the `NoteStore` interface and is the central architectural decision of the slice.
- **Inline rename:** trigger (double-click / F2 / dedicated affordance), commit/cancel keys, and reuse of the store's title sanitizing + collision handling.
- **Testing setup:** `environment: 'jsdom'` for `*.test.tsx`, `@testing-library/react` (`render`, `renderHook`), and which behaviors to cover first (the conflict resolvers are high-value).

## Process to follow in the fresh session

1. Read this doc, `CLAUDE.md`, and `docs/superpowers/specs/2026-06-19-*.md` for context.
2. Invoke **superpowers:brainstorming** → work through the open questions above with the user → write the spec to `docs/superpowers/specs/YYYY-MM-DD-core-ux-navigation-design.md` and commit.
3. Invoke **superpowers:writing-plans** → bite-sized TDD implementation plan in `docs/superpowers/plans/`.
4. Create a feature branch (e.g. `core-ux-navigation`), execute with **superpowers:executing-plans** (inline, as in slices 1–2), committing per task.
5. Verify `lint && format:check && typecheck && test && build`, push, open a PR, confirm CI green, then **superpowers:finishing-a-development-branch**.

## Conventions reminder

4-space indent + single quotes (Gravity Prettier); ESLint enforces formatting on JS/TS via `eslint-plugin-prettier`; automatic JSX runtime (no React import); `void promise()` marks intentionally-unawaited promises; errors surface through the toaster (`onError` in `Workspace`); keep all persistence behind the `NoteStore` seam.

## Note: `gravity-build` plugin now installed

A `gravity-build` plugin/marketplace was just added (run `/reload-plugins` to activate). Its skills (`gravity-build:create`, `synthesize-profile`, `write-back`, `feedback`) build Gravity UI on real components "as accepted," with version pinning and an optional per-service profile. It's **optional** for this slice (we're extending an existing app, not generating a new screen) but may help with component selection/conventions for the new search/sort/shortcut UI — consider it during brainstorming.

## Pointers

- Specs: `docs/superpowers/specs/2026-06-19-code-health-foundation-design.md`, `…-robustness-data-safety-design.md`
- Plans: `docs/superpowers/plans/2026-06-19-code-health-foundation.md`, `…-robustness-data-safety.md`
- Merged PRs: #1 (code health), #2 (robustness)
