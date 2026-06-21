# UX Polish, Theming & Bug Fixes — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** Backlog cleanup on the `remove-tabs-nvalt` branch. Handles the README "Small design
  things" (editor/theme polish) plus the three "Bugs", after the nvALT navigation slice. The literal
  "UX tasks" backlog items were already delivered by nvALT (ESC ladder + arrow nav) or made moot (tabs).

## Context

The single-pane nvALT app is in place. This pass is a grab-bag of small, mostly-independent UX
improvements the user listed, grounded in the actual editor/theme APIs:

- `@gravity-ui/markdown-editor`'s `MarkdownEditorView` exposes `settingsVisible` and `toolbarVisibility`
  props (no hacks needed to hide the toolbar/gear). Its content renders under `.g-md-editor`.
- Gravity UI's accent is the **brand** CSS-variable group (`--g-color-base-brand*`, `…-selection*`,
  `…-line-brand`, `…-text-brand*`, `…-text-link*`), mapped from the private **yellow** scale by default;
  a private **blue** scale (`--g-color-private-blue-*`) ships in the same stylesheet.
- `FileSystemNoteStore.rename` resolves collisions with `uniqueFileName` (appends ` 2`), which is the
  rename-to-existing bug.
- Keyboard shortcuts run through `SHORTCUTS` (`src/shortcuts.ts`) + a single global handler
  (`useShortcuts`): `mod` combos fire regardless of focus; bare keys are gated against typing surfaces.
  The ⌘K and F2 bugs are both about _when_ a shortcut should fire relative to the editor — one unified
  fix.

These are presentation + small-logic changes; persistence stays behind `NoteStore`.

## Goal

Ship the editor/theme polish and the three bug fixes without regressing the nvALT flow, autosave, or
conflict handling.

### Success criteria

- **Editor reads cleaner:** smaller top padding (left side unchanged), tighter line-height, Apple-Notes
  dash bullets, breathing room between a checklist checkbox and its label, and **no toolbar or settings
  gear** (Markdown-first surface).
- **Accent is blue** everywhere the yellow-orange showed (buttons, selection, focus rings, links), in
  both light and dark themes.
- **Theme has three modes** — Light / Dark / **System** — chosen from a header control, persisted, with
  System tracking the OS preference live.
- **F2 renames the selected note** from anywhere (not only when a list row holds focus).
- **⌘K inserts a link while editing** (the editor keeps it); ⌘K still focuses search from the list/body.
- **Renaming a note to an existing note's name does nothing** — no auto-numbered ` 2` copy.
- No regressions to nvALT navigation, search, sort, pinning, autosave, save-on-close, or conflicts.

## Decisions (with rationale)

- **Hide the toolbar via props, not CSS.** `settingsVisible={false}` + `toolbarVisibility="hidden"` is
  the supported API; a CSS fallback on `.g-md-toolbar` / `.g-md-editor-settings` is only a safety net if
  the prop value differs. This obsoletes the "toolbar button padding" item.
- **One unified `inTyping` flag on shortcut bindings** fixes both F2 and ⌘K. A binding may declare
  whether it fires while a typing surface is focused; the default preserves today's behavior (`mod` →
  yes, bare → no). ⌘K sets it `false` (yield to the editor); F2 sets it `true` (rename even mid-edit).
  Cleaner than special-casing keys in the handler.
- **F2 routes through one path.** Make it a global shortcut that renames `nav.selectedId` via a new
  `NoteList` imperative `startRename(id)`, and remove the row-local F2 — so there's a single code path
  and it works regardless of where focus sits.
- **Rename collision = silent no-op** (per the user's "do nothing"). `rename` returns the unchanged meta
  when the target filename is taken by a different note; the inline editor simply reverts to the old
  title. No toast (keep it quiet).
- **Theme preference defaults to `system`** for fresh installs; existing `light`/`dark` values in
  `localStorage` are preserved. A small header **dropdown** (Light / Dark / System) replaces the 2-way
  toggle — discoverable and shows all three at once.
- **Accent re-brand lives in `index.css`**, scoped to the theme roots, mapping the brand vars level-for-
  level from yellow to blue. CSS-only; no `ThemeProvider` API exists for accent.

## Detailed design

### A. Editor presentation

- **Top padding:** `src/components/Workspace.css` — `--g-md-editor-padding: 8px 16px` →
  `4px 16px 8px 16px` (top 4 / right 16 / bottom 8 / left 16; left unchanged).
- **Hide toolbar/gear:** `src/components/EditorPane.tsx` — render
  `<MarkdownEditorView settingsVisible={false} toolbarVisibility="hidden" editor={editor} />` (drop the
  now-pointless `stickyToolbar`). Keep `autofocus`.
- **New `src/components/EditorPane.css`** (imported by `EditorPane.tsx`) for content overrides scoped
  under `.g-md-editor`:
  - **Line-height** of the editor body to ~`1.45`.
  - **Dash bullets:** unordered-list markers rendered as a short dash ("– ") Apple-Notes style (override
    `::marker`, or `list-style: none` + an `::before` dash if `::marker` content proves unreliable in
    the YFM markup).
  - **Checklist spacing:** a gap between the task-list checkbox and its label.
  - The exact YFM/ProseMirror selectors are confirmed by inspecting the rendered editor DOM during
    implementation (these are visual, manually verified — see Testing).

### B. Accent → blue (`src/index.css`)

Override the brand variable group under both theme roots (`.g-root_theme_light`, `.g-root_theme_dark`),
mapping each yellow private-scale reference to the same blue level, e.g.:

```css
.g-root_theme_light {
  --g-color-base-brand: var(--g-color-private-blue-550-solid);
  --g-color-base-brand-hover: var(--g-color-private-blue-600-solid);
  --g-color-base-selection: var(--g-color-private-blue-150);
  --g-color-base-selection-hover: var(--g-color-private-blue-200);
  --g-color-line-brand: var(--g-color-private-blue-600-solid);
  --g-color-text-brand: var(--g-color-private-blue-600-solid);
  --g-color-text-brand-heavy: var(--g-color-private-blue-700-solid);
  --g-color-text-link: var(--g-color-private-blue-550-solid);
  --g-color-text-link-hover: var(--g-color-private-blue-700-solid);
  /* …matching the full yellow set the theme defines… */
}
.g-root_theme_dark {
  /* same vars mapped to the dark theme's blue levels */
}
```

The implementation mirrors the complete yellow var set Gravity defines per theme (confirmed by reading
`@gravity-ui/uikit/styles/styles.css`); the `note-list__match` highlight (currently a yellow
`--g-color-base-warning-medium`) is left as-is — it's a search highlight, not the accent.

### C. System theme (`src/App.tsx` + header control)

`App.tsx`:

```ts
type ThemePref = 'light' | 'dark' | 'system';
const THEME_KEY = 'gravity-notes:theme';

function initialPref(): ThemePref {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}
function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
```

- State: `pref: ThemePref` (persisted to `THEME_KEY` on change) + a resolved `theme: Theme`.
- Resolve: `theme = pref === 'system' ? systemTheme() : pref`. An effect adds a `change` listener on the
  `matchMedia` query **only while `pref === 'system'`**, updating the resolved theme on OS change.
- `ThemeProvider` receives the resolved `theme`.
- `Workspace` props change: `theme`/`onToggleTheme` → `themePref: ThemePref` +
  `onChangeThemePref(pref)`. The resolved `theme` is still passed for any theme-dependent icon if needed.
- **Header control:** replace the Sun/Moon flat button with a Gravity `DropdownMenu` (icon-button
  switcher) listing **Light / Dark / System** (icons e.g. `Sun` / `Moon` / `Display`); the trigger icon
  reflects the current `themePref`.

### D. Bug fixes

**Shared shortcut change** (`src/shortcuts.ts` + `src/hooks/useShortcuts.ts`):

- `GlobalBinding` gains `inTyping?: boolean` — "may fire while a typing surface is focused." In
  `useShortcuts`, compute `allowInTyping = binding.inTyping ?? (binding.trigger === 'mod')`; when the
  active element is a typing target and `!allowInTyping`, skip the binding. (Preserves all current
  behavior by default.)
- `ShortcutAction` gains `renameSelected`. `ShortcutActions` adds the callback.

**F2:**

- `SHORTCUTS`: the `f2` row gains `global: {trigger: 'bare', key: 'F2', action: 'renameSelected',
inTyping: true}` (fires even with the editor focused). Description stays "Rename selected note".
- `NoteList`: `NoteListHandle` gains `startRename(id: string)` (finds the note in `notes`, seeds the
  rename input, enters edit mode); **remove** the `F2` case from `onItemKeyDown`.
- `Workspace`: wire `renameSelected: () => { if (nav.selectedId) listRef.current?.startRename(nav.selectedId); }`.

**⌘K:**

- `SHORTCUTS`: the `mod+k` (focus-search) binding sets `inTyping: false` → it does not fire while the
  editor or an input is focused, so the editor's ⌘K insert-link works. ⌘J (`createNote`) and ⌘/
  (`toggleEditorMode`) keep the default (`inTyping` true via the `mod` default) and still fire in the
  editor.

**Rename collision** (`src/storage/fileSystemStore.ts`):

- In `rename`, after computing `nextName = sanitizeTitle(nextTitle) + '.md'`: if `nextName !== id` **and**
  `await this.exists(nextName)`, return `{id, title: titleFromFileName(id)}` unchanged (no copy, no
  delete, no auto-number). Otherwise create `nextName` directly (not via `uniqueFileName`) and
  copy-then-delete as today. `create` keeps using `uniqueFileName` (auto-numbering is correct there).
- `useNotes.rename` already no-ops gracefully when `meta.id === id` (skips the remap, refreshes); the
  inline editor reverts to the old title.

## Testing

**Unit-testable (Vitest):**

- `useShortcuts`: ⌘K does **not** call `focusSearch` when an input/contenteditable is focused, but does
  from the body; ⌘J still fires while typing; F2 calls `renameSelected` even while an input is focused;
  `?` stays gated.
- `App` theme resolution: `system` resolves via a mocked `matchMedia` and updates on its `change` event;
  `light`/`dark` are honored and persisted; `initialPref` coerces junk to `system`.
- Header switcher: choosing Light / Dark / System calls `onChangeThemePref` with the right value.
- `NoteList`: `startRename(id)` enters edit mode for that note; `Workspace` F2 → the rename input
  appears for the selected note.
- `fileSystemStore.rename`: renaming to a free name works; renaming to an existing **different** note's
  name is a no-op (no new file, original untouched); rename to the same name is a no-op.

**Manual (Chromium smoke — visual, can't be automated):** top padding, line-height, dash bullets,
checklist spacing, hidden toolbar/gear, and the blue accent across light + dark. Listed in the plan's
manual-verification step.

## Out of scope (YAGNI)

- "Toolbar button padding" (obsoleted — toolbar is hidden).
- Manual-save + crash buffer, folders, Electron, PWA, backend sync (separate backlog "Other things").
- Per-note theme, custom-color picker, high-contrast theme.
- A toast on rename collision (kept a silent no-op per the request).

## Risks & mitigations

- **Editor CSS selectors are third-party.** Line-height / bullets / checklist overrides depend on YFM/
  ProseMirror classes that may shift. Mitigation: scope under `.g-md-editor`, confirm against the
  rendered DOM, keep overrides minimal; they're manually verified, not unit-tested.
- **Accent var coverage.** Missing a brand var leaves a stray yellow spot. Mitigation: mirror the full
  yellow set Gravity defines per theme; manual smoke in both themes; quick tweak pass expected.
- **`toolbarVisibility` value.** If `"hidden"` isn't the exact accepted value, fall back to the CSS
  display:none on `.g-md-toolbar` / `.g-md-editor-settings`.
- **Shortcut gate regressions.** The `inTyping` default must reproduce today's behavior exactly.
  Mitigation: `inTyping ?? (trigger === 'mod')` + tests for every existing binding.

## Implementation order

1. **Shortcut fixes** (`shortcuts.ts` + `useShortcuts.ts`): `inTyping` flag, `renameSelected` action,
   ⌘K gate, F2 binding + tests. (Pure logic.)
2. **`NoteList.startRename` handle** + remove row-local F2; `Workspace` wires F2 → rename + tests.
3. **Rename collision no-op** (`fileSystemStore.ts`) + tests.
4. **System theme** (`App.tsx` + header dropdown) + tests.
5. **Accent → blue** (`index.css`).
6. **Editor presentation** (`Workspace.css` padding, `EditorPane.tsx` hide-toolbar props, new
   `EditorPane.css` content overrides).
7. Manual Chromium smoke for the visual items (5–6) + the blue accent; update the README TODO (strike
   the done items).
