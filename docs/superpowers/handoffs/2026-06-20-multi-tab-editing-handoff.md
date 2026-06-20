# Next-Session Handoff — Multi-tab Editing shipped; what's next

A handoff for resuming in a fresh session. Read it together with `CLAUDE.md`, the multi-tab spec
(`docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md`) and plan
(`docs/superpowers/plans/2026-06-20-multi-tab-editing.md`).

## Where things stand (as of 2026-06-20)

- Branch: **`main`, clean working tree, but NOT pushed** — `main` is **14 commits ahead of
  `origin/main`**. The multi-tab work was merged **locally** (fast-forward). First action next session:
  decide whether to **push `main`** (or open a PR). Mind the local-main divergence trap.
- All gates green at the merge point: **lint 0 errors** (6 pre-existing warnings), **format:check clean**,
  **typecheck clean**, **125 tests across 12 files**, production build OK.
- Commands unchanged: `npm run dev | build | preview | test | test:watch | lint | lint:fix | format |
format:check | typecheck`.
- Roadmap slices 1–3b were already merged previously. **Multi-tab editing** (this session) is a net-new
  feature sequenced after 3b — see `CLAUDE.md`. Roadmap slices **4 (Richer editing)** and
  **5 (Image attachments)** are still open; the richer-editing kickoff at
  `docs/superpowers/handoffs/2026-06-20-richer-editing-kickoff.md` is still valid.

## What shipped this session — Multi-tab editing

Open notes as switchable editor tabs, persisted and restored across reloads. Built brainstorm → spec →
plan → subagent-driven execution (6 tasks, each with spec-compliance + code-quality reviews and fix
loops, plus a final whole-branch review).

Touchpoints:

- `src/storage/types.ts` + `src/storage/metadata.ts` — `NotesMetadata` gained `open: readonly string[]`
  and `active: string | null` (additive, still `version: 1`), with pure helpers `withOpened` /
  `withClosed` (neighbor-activation: right → left → null) / `withActive` (guards against a non-open id);
  `parseMetadata` clamps `active` into `open`; `reconcile` / `withRenamed` / `withRemoved` propagate to
  `open`/`active`.
- `src/hooks/useNotes.ts` — **rewritten to a per-tab model (Approach A: state centralized in the hook).**
  `openIds`/`activeId` mirror `metadata.open`/`metadata.active`; per-id maps for `openNotes`,
  `saveStates`, `conflicts`, plus per-id refs for pending edits / baselines / autosave timers. Actions
  `open` / `activate` / `close`; `edit(id, content)`; conflict resolvers act on the **active** tab;
  `discard` closes the active tab. Restore-on-load hydrates every open tab (drops missing ones + heals
  the dotfile). `beforeunload`/`visibilitychange` flush **all** dirty tabs; refocus scans **all** open
  tabs for external edits. Timers cleared on unmount; rename blocked while a tab is conflicted.
- `src/components/EditorPane.tsx` — gained `active: boolean`; only the active pane autofocuses and it
  refocuses when it becomes active (so many panes can stay mounted without fighting for focus).
- `src/components/TabBar.tsx` + `TabBar.css` — presentational strip: `role="tablist"` of
  `role="tab"` buttons (`aria-selected`), per-tab unsaved/conflict dots (sibling of the tab so they stay
  out of the accessible name), a close × (and middle-click close), focus ring matching the note list.
- `src/components/Workspace.tsx` + `Workspace.css` — renders the `TabBar` + a `.workspace__panes`
  stack of one mounted `EditorPane` per open tab (inactive ones `hidden`). Outer wrapper `key={id}`
  (stable across switches) vs inner EditorPane `key={`${id}:${updatedAt}`}` (remounts only on a
  disk-reload). The `editorRef` (toggle-mode shortcut) attaches to the active pane only; the conflict
  banner + header save-state come from the active tab.

Tests: `metadata.test.ts`, `useNotes.test.tsx` (open/activate/close, persist+restore, drop-missing,
per-tab autosave, background-tab conflict, rename/remove of an open tab, all conflict resolvers),
`TabBar.test.tsx`, `Workspace.test.tsx` (open-from-sidebar, close, re-activate).

## Known gaps / deferred (from the reviews)

- **Tab a11y + keyboard navigation (deferred together).** The tab strip uses `role="tablist"`/`tab` but
  **not** the full ARIA tabs pattern: no `aria-controls` on tabs / `role="tabpanel"` + `aria-labelledby`
  on the panes, and **no arrow-key roving / close/switch hotkeys** (⌘W, ⌘1–9, Ctrl+Tab are
  browser-reserved). These belong together as one "complete tab keyboard + a11y" follow-up. (Note:
  wiring `aria-controls` needs sanitized ids — note ids are filenames with spaces/dots.)
- **No real-browser smoke was run.** The app gates on the File System Access folder picker (an
  interactive native dialog that automation can't drive), so verification was component/hook tests +
  build only. Worth a manual pass next session: open several notes → tabs accumulate; switch tabs and
  confirm cursor/scroll/undo are preserved per tab; reload (re-grant folder permission) and confirm the
  same tabs + active tab return; external-edit a background tab's file → its tab shows the conflict dot,
  banner appears on activating it, Reload loads disk content fresh.
- **Minor (benign, not fixed):** `onHide` (`useNotes.ts`) runs `flushAll()` on the visibility _show_
  transition too, not only hide — harmless and pre-existing (a flush against a diverged disk yields a
  `ConflictError`, not a false "saved"); a `document.visibilityState === 'hidden'` guard would tidy it
  but breaks the current hide test (which mocks `visibilityState: 'visible'`). And `openNotes` can retain
  an unreachable entry for a note deleted externally until its tab is explicitly closed (not rendered
  from `openIds`, so user-invisible).

## Candidate next work — the user's fresh feedback (see `README.md` TODO)

The user added TODOs this session; several are direct feedback on the tabs just shipped and pair
naturally with a follow-up "tabs polish" slice:

- **Ephemeral / preview tabs (VS Code / Sublime style):** single-click a sidebar note opens an
  _ephemeral_ tab (italic name); a double-click or any edit promotes it to a normal tab; while a tab is
  ephemeral, clicking another note **replaces** it instead of opening a new tab (at most one ephemeral
  tab). This reshapes `open()` semantics + the `TabBar`.
- **More compact tab layout:** remove the empty space _above_ the tabs and make tabs a bit **taller**.
- **`+` button on the tab pane:** opens an existing file or creates a new note.
- **Tab hotkeys** (ties into the deferred keyboard-nav gap above).
- **Smaller padding _above_ the editing area, leaving the left side alone.** Currently
  `--g-md-editor-padding: 8px 16px` in `Workspace.css` (8px top/bottom, 16px sides). Split to a 4-value
  shorthand to shrink the top only, e.g. `4px 16px 8px 16px` (top/right/bottom/left).
- **"Saving indicator is too annoying."** Revisit the header save-state / per-tab unsaved dot UX.

Other backlog items in `README.md` (not tab-specific): ESC to defocus then close + arrow-key note
navigation when unfocused; "system theme" option; non-yellow accent; smaller editor line-height;
dash bullets (Apple-Notes style); **bugs:** F2 rename hotkey doesn't fire, ⌘K conflicts with the
editor's insert-link, rename-to-an-existing-name should no-op rather than auto-number; **backlog:**
folders, Electron, PWA, backend sync.

## Process to follow in the fresh session

1. Read this doc + `CLAUDE.md` + the multi-tab spec/plan.
2. **Push `main`** (or open a PR) to clear the 14-commit local-only divergence — confirm with the user.
3. (Recommended) run the manual real-browser smoke above to confirm the merged feature end-to-end.
4. Pick the next slice **with the user** (the "tabs polish" cluster above is the natural follow-on; the
   quick padding tweak can be a standalone small change). Then **superpowers:brainstorming** →
   spec → **superpowers:writing-plans** → plan.
5. Work on a **feature branch** off up-to-date `main` (avoid the local-main divergence trap), execute
   with **superpowers:subagent-driven-development**, finish with
   **superpowers:finishing-a-development-branch**.

## Conventions reminder

4-space indent + single quotes (Gravity Prettier); ESLint enforces formatting on JS/TS; **Prettier also
checks `.md`** — run `npm run format` on new docs (`format:check` is in CI; it reformats fenced code
blocks inside markdown to 2-space, so `.ts`/`.tsx` source still needs 4-space via `lint:fix`). Automatic
JSX runtime; `void promise()` marks intentional unawaited promises; errors surface through the toaster
(`onError` in `Workspace`); keep persistence behind the `NoteStore` seam.

## Pointers

- This feature — spec: `docs/superpowers/specs/2026-06-20-multi-tab-editing-design.md`; plan:
  `docs/superpowers/plans/2026-06-20-multi-tab-editing.md`.
- Prior handoffs/specs/plans for slices 1–3b live alongside in `docs/superpowers/`.
- Open roadmap: slice 4 (Richer editing — kickoff handoff dated 2026-06-20), slice 5 (Image
  attachments); a tail dependency-trim pass follows (4)/(5).
