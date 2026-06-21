# Global ⌘J/⌘K Note Navigation — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** Keyboard-shortcut rework on the `remove-tabs-nvalt` branch. Adds global note
  navigation and resolves the long-standing ⌘K-vs-insert-link conflict the earlier UX-polish spec
  flagged. Follows the in-editor title-field work.

## Context

Today the note list is navigated with **bare ↓/↑ and j/k**, handled inside `NoteList` — they only work
when focus is in the list. To move between notes you must first `Esc` out of the editor. The user wants
**⌘J/⌘K to browse notes from anywhere**, including mid-edit.

The blocker is a key conflict: the markdown editor binds **⌘K to insert-link**, so `shortcuts.ts`
deliberately leaves ⌘K alone (`"⌘K is deliberately left to the editor's insert-link command"`). And
**⌘J is currently the new-note shortcut** (`mod+j` → `createNote`). So enabling ⌘J/⌘K for navigation
requires relocating both.

Verified against `@gravity-ui/markdown-editor` v15.41.0:

- The **Link extension takes a `linkKey` option** and only binds a key when one is given
  (`extensions/markdown/Link/index.js`: `if (opts?.linkKey) builder.addKeymap(...)`). The bundle's
  default is `link: { linkKey: f.toPM(A.Link), ...opts.link }`, overridable via
  `wysiwygConfig.extensionOptions.link.linkKey`. So ⌘K can be re-bound to **⇧⌘K** cleanly.
- **Nothing else in the editor binds `Mod-j` or `Mod-k`**, and **`Mod-Enter` is unbound** unless an
  `onSubmit` handler is passed (we don't). So ⌘J, freed ⌘K, and ⌘Enter all bubble to the document-level
  global handler. Markup (CodeMirror) mode has no `Mod-k` link binding, so no markup conflict.

The global shortcut layer (`useShortcuts` + the `SHORTCUTS` descriptor) already fires `mod` combos
regardless of focus (including typing surfaces) and `preventDefault`s them — it's the right seam, and it
needs no logic change.

## Goal

Make **⌘J / ⌘K** browse to the next / previous note from anywhere (same effect as ↓/↑ in the list), move
**insert-link to ⇧⌘K**, and move **new-note to ⌘Enter**. No regressions to existing in-list ↓/↑/j/k,
autosave-on-switch, search, or the rest of the shortcut set.

### Success criteria

- **⌘J / ⌘K** select the next / previous note in the current (filtered) list order and **preview** it,
  moving focus to that list row — identical to ↓/↑ in the list, but working while the editor or search
  box is focused. They clamp at the ends (no wrap). With nothing selected, ⌘J picks the first note and
  ⌘K the last.
- Switching via ⌘J/⌘K **flushes the outgoing note's pending edit** (it goes through the same `open`
  path as ↓/↑, which flushes first).
- Existing **bare ↓/↑ and j/k** in the list are unchanged.
- **⇧⌘K inserts a link** in the editor; plain **⌘K no longer inserts a link**.
- **⌘Enter creates a new note** (from anywhere, including mid-edit) and lands focus in the new note's
  title (the existing create flow). Plain **⌘J no longer creates a note**.
- The help dialog (`?`) lists the new bindings.

## Decisions (with rationale)

- **⌘J = next/down, ⌘K = prev/up**, mirroring the vim j/k already used in-list. Consistent muscle memory.
- **Browse (preview) semantics, not open-for-edit** (user's choice). ⌘J/⌘K behave exactly like ↓/↑:
  move the selection, preview the note, focus the list row; `Enter` then edits. Keeps one navigation
  model rather than two, and reuses the existing browse path.
- **Re-bind the editor's link key to ⇧⌘K** via the supported `linkKey` option rather than intercepting
  ⌘K at the document level. Letting the editor simply not own ⌘K is cleaner and avoids event-ordering
  fragility (no double-firing).
- **New-note → ⌘Enter.** ⌘N/⌘T/⌘⇧N are browser-reserved and non-interceptable; ⌘Enter is free in the
  editor (no `onSubmit`) and is a common "create/commit" gesture.
- **Keep the bare in-list ↓/↑/j/k.** ⌘J/⌘K are strictly additive ("works from anywhere"); removing the
  bare keys would be a regression with no benefit.
- **No logic change to `useShortcuts`.** It's descriptor-driven; adding rows to `SHORTCUTS` plus two new
  action names is enough. `mod` bindings already default to `inTyping: true` and `preventDefault`.

## Detailed design

### `src/shortcuts.ts`

- Extend `ShortcutAction` with `'selectNextNote' | 'selectPrevNote'`.
- **Remove** the `mod+j` → `createNote` descriptor.
- **Add** to the **Navigation** group (placed right after the bare `down` row):
  - `mod+j` → `selectNextNote` — description "Next note (preview)".
  - `mod+k` → `selectPrevNote` — description "Previous note (preview)".
  - Each: `global: { trigger: 'mod', key: 'j' | 'k', action }`. (`inTyping` is omitted — `mod`
    defaults to firing while typing, which is required for "from anywhere".)
- **Add** to the **Editing** group:
  - `mod+enter` → `createNote` — description "New note" (`global: { trigger: 'mod', key: 'Enter',
    action: 'createNote' }`). `useShortcuts` matches `event.key.toLowerCase() === 'enter'`.
  - A **non-global** help-only row `mod+shift+k` → description "Insert link (in the editor)" (no
    `global` binding; the editor's keymap owns it). For discoverability in the help sheet.
- Leave the existing `up` / `down` (bare nav), `enter`, `esc` / `esc esc`, `mod+/`, `mod+shift+p`, `f2`,
  `?` rows as they are.

### `src/hooks/useShortcuts.ts` + `ShortcutActions`

`ShortcutActions` is `Record<ShortcutAction, () => void>`, so it automatically requires
`selectNextNote` / `selectPrevNote`. No change to the handler body.

### `src/components/Workspace.tsx`

- Add a `browseRelative(delta: number)` callback:
  - `ids = filteredNotes.map(n => n.id)`; if empty, return.
  - If `nav.selectedId` is null or not in `ids`: target index `delta > 0 ? 0 : ids.length - 1`.
  - Else: `clamp(indexOf(selectedId) + delta, 0, ids.length - 1)`.
  - `enterList(ids[targetIndex])` — the existing helper that previews the note (`nav.browse`) and moves
    DOM focus to that list row (`listRef.focusRow`).
- Wire `useShortcuts({ …, selectNextNote: () => browseRelative(1), selectPrevNote: () =>
  browseRelative(-1) })`. `createNote` stays wired to `handleCreate` (only its key changed).

### `src/components/EditorPane.tsx`

Pass the link re-bind through `useMarkdownEditor`:

```ts
const editor = useMarkdownEditor(
    {
        md: {html: false},
        initial: {markup: note.content, mode: 'wysiwyg'},
        wysiwygConfig: {extensionOptions: {link: {linkKey: 'Mod-Shift-k'}}},
    },
    [],
);
```

### `src/components/ShortcutsDialog.tsx`

No code change — it renders from `SHORTCUTS`. Only its test's hard-coded assertions may need touch-ups.

### Data flow

```
⌘J / ⌘K (anywhere) ─▶ useShortcuts (mod, preventDefault) ─▶ selectNext/PrevNote
                    ─▶ browseRelative(±1) ─▶ enterList(neighbor) ─▶ nav.browse + focusRow ─▶ preview
⌘Enter (anywhere)  ─▶ useShortcuts ─▶ createNote ─▶ handleCreate ─▶ new note, title focused
⇧⌘K (in editor)    ─▶ editor keymap (linkKey) ─▶ insert link
```

### Error handling

No new failure surface. Empty / fully-filtered list → ⌘J/⌘K no-op. Navigation reuses the existing
`open`/`browse` path (flush-before-switch, conflict handling) unchanged.

## Testing (TDD)

- **`useShortcuts`:** `mod+j` fires `selectNextNote` and `mod+k` fires `selectPrevNote`, **including while
  a typing surface (input/contenteditable) is focused**; `mod+enter` fires `createNote`; the old
  `mod+j` → `createNote` no longer fires.
- **`Workspace` (integration, fake store):** with a note open, **⌘J** moves the selection/preview to the
  next row and **⌘K** to the previous (assert `aria-selected`); ⌘J works **while the editor is focused**;
  ⌘K at the first row stays put (clamp); **⌘Enter** creates a note.
- **`ShortcutsDialog`:** the per-descriptor render test covers the new rows; update the hard-coded
  assertions only if a referenced string changed (the "New note" text is unchanged).
- **Not unit-testable (editor is mocked):** the actual ⇧⌘K link re-bind. Covered by the manual Chromium
  smoke test — confirm ⌘K navigates (no link popup) and ⇧⌘K opens the link form.

## Out of scope (YAGNI)

- Wrap-around navigation at the list ends.
- A markup-mode link key (none is bound there).
- A dedicated focus-search hotkey (search box is always visible; the `Esc` ladder reaches it).
- Touching the user's uncommitted `README.md`.

## Risks & mitigations

- **⌘J intercept vs. the browser's "show downloads".** Mitigation: the app already used `mod+j`
  successfully (it `preventDefault`s); behavior is unchanged in that respect.
- **`linkKey` re-bind unverifiable in jsdom** (the real editor can't mount there). Mitigation: it's a
  one-line supported config; verified by the manual smoke test.
- **Double-firing if the editor secretly bound ⌘J/⌘K/⌘Enter.** Mitigation: grepped the editor — only
  link binds `Mod-k` (re-bound away), and `Mod-j` / `Mod-Enter` are unbound.

## Implementation order

1. `shortcuts.ts`: action names + descriptor changes (+ help row).
2. `useShortcuts` tests for the new/changed bindings.
3. `Workspace`: `browseRelative` + wiring + integration tests.
4. `EditorPane`: `linkKey` config.
5. `ShortcutsDialog` test touch-up. Full test/lint/build. Manual Chromium smoke (⌘J/⌘K nav, ⇧⌘K link,
   ⌘Enter new note). Update `CLAUDE.md` roadmap.
