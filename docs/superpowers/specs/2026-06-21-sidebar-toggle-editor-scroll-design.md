# Sidebar Toggle Rework + Editor Scroll — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** Follow-up refinements on the `remove-tabs-nvalt` branch, after the UX-polish batch.
  Reworks the collapsible-sidebar interaction (the hover-peek the user disliked) and adjusts the editor
  scroll (unpin the title, add end-of-note scroll room).

## Context

The UX-polish batch shipped a collapsible sidebar with a **hover-peek overlay**: a toggle inside the
`NoteList` toolbar collapses it, and a slim left-edge button reveals it as an overlay on hover. The user
dislikes the hover model and wants a plain toggle + a keyboard shortcut. Two editor tweaks ride along.

Current state (relevant):

- `Workspace` owns `collapsed` (a boolean, persisted in `localStorage['gravity-notes:sidebar-collapsed']`),
  renders `.workspace__body` with a `workspace__body_collapsed` modifier, a `.workspace__sidebar-reveal`
  button, and passes `collapsed`/`onToggleCollapsed` to `NoteList`. `Workspace.css` has the
  overlay/peek/reveal rules.
- `NoteList` renders the collapse toggle (ChevronLeft/Right) as the first item in `.note-list__toolbar`.
- The global shortcut layer is descriptor-driven: `SHORTCUTS` (`src/shortcuts.ts`) feeds both
  `useShortcuts` and the help dialog; `mod` combos fire regardless of focus and `preventDefault`.
- `EditorPane` is a flex column: `.note-title` (fixed header) above `.editor-pane__body`
  (`overflow: auto`, the scroller). The title is therefore **pinned**; the body scrolls under it.
- The editor's content padding comes from `--g-md-editor-padding: 4px 16px 8px 16px` on
  `.workspace__editor`.

Verified: `LayoutSideContent` exists in `@gravity-ui/icons`; `Mod-'` (⌘') is unbound by the editor (its
blockquote shortcut is `Mod-Shift-.`), so ⌘' is free for a global app shortcut.

## Goal

Replace the hover-peek with a **single always-visible toggle** (top bar) + a **⌘' shortcut**; **unpin the
title** so it scrolls with the content; add **~300px of end-of-note scroll room**. No regressions to the
collapse *state* + persistence, nav, search, or the editor.

### Success criteria

- A `LayoutSideContent` toggle button sits at the **far-left of the top bar**, always visible (docked or
  collapsed). Clicking it, or pressing **⌘'**, toggles the sidebar.
- **Collapsed = hidden** (the editor fills the width). No overlay, no hover, no edge strip. The Task-6
  in-list toggle, the reveal button, and the overlay/peek CSS are gone.
- Collapsed state still **persists** across reloads.
- The note **title scrolls away** with the content (the title + body share one scroll container).
- There is **~300px of scroll room** after the last line; clicking that space drops the cursor at the
  end of the note.

## Decisions (with rationale)

- **One top-bar toggle, not an in-list toggle (option A).** An always-visible control is the only model
  that needs no hover and stays reachable when collapsed (the in-list toggle vanishes with the sidebar).
  It's the conventional pattern (VS Code / Notion / Obsidian) and consolidates open + close into one
  button. The `LayoutSideContent` icon lives here.
- **`collapsed` state stays in `Workspace`; it just flows to `TopBar` now (not `NoteList`).** Minimal
  change to the proven state/persistence; `NoteList` reverts to a pure list.
- **Collapsed hides the sidebar via `display: none` (kept mounted), not unmount.** Preserves list
  scroll/selection and avoids a remount; the editor's `flex: 1` fills the freed width.
- **⌘' = a new `toggleSidebar` shortcut action**, added to `SHORTCUTS` (so the help dialog lists it) and
  `ShortcutActions`. `useShortcuts` needs no logic change (it's descriptor-driven; `mod` fires while
  typing, so ⌘' works from the editor too).
- **Unpin the title by moving the scroll to `.editor-pane`** (the outer container) and letting the
  editor body grow to content, rather than restructuring the JSX. The title is already the first child
  of `.editor-pane`; making the pane the scroller lets the title scroll away naturally.
- **End padding via `--g-md-editor-padding`'s bottom value**, so the room is *inside* the editor's
  content box — clicking it focuses the editor (caret to end), not dead wrapper space.
- **Items 4 & 5 are CSS, tuned live.** The exact scroll behavior (ProseMirror cooperating with the outer
  scroller) and the 300px value are confirmed in the browser; the spec fixes the approach + files.

## Detailed design

### Shortcut — `src/shortcuts.ts` + `useShortcuts`

- Extend `ShortcutAction` with `'toggleSidebar'`.
- Add a descriptor: `{ keys: 'mod+\'', description: 'Toggle the notes sidebar', group: 'Navigation',
  global: { trigger: 'mod', key: "'", action: 'toggleSidebar' } }`. (`event.key` for ⌘' is `'`;
  `useShortcuts` matches case-insensitively and `mod` bindings default to firing while typing.)
- `ShortcutActions` (`Record<ShortcutAction, () => void>`) automatically requires the new key.

### `TopBar` — the toggle button

- New props: `collapsed: boolean`, `onToggleCollapsed: () => void`.
- Render a `Button` (`view="flat"`, `LayoutSideContent` icon) as the **first child** of `.topbar`, before
  the search box. `aria-label="Toggle notes sidebar"`, `title` the same, `aria-pressed={!collapsed}`
  (pressed = sidebar shown), `onClick={onToggleCollapsed}`. A `.topbar__sidebar-toggle` class for any
  spacing tweaks.

### `Workspace` — wiring + collapsed layout

- Keep `collapsed` state + the `localStorage` persistence effect + `toggleCollapsed` (unchanged).
- Pass `collapsed={collapsed}` + `onToggleCollapsed={toggleCollapsed}` to **`TopBar`** (remove them from
  `NoteList`).
- **Remove** the `.workspace__sidebar-reveal` button from the JSX. Keep the `workspace__body_collapsed`
  modifier on `.workspace__body` (now it just hides the sidebar).
- Wire the shortcut: add `toggleSidebar: toggleCollapsed` to the `useShortcuts({…})` call.

### `NoteList` — revert the toggle

- Remove the collapse `Button` from `.note-list__toolbar` (the `Select` + "New" return to being the only
  toolbar children).
- Remove the `collapsed` / `onToggleCollapsed` props from `NoteListProps` and the destructure, and the
  `ChevronLeft` / `ChevronRight` imports. Remove `collapsed`/`onToggleCollapsed` from `NoteList.test.tsx`'s
  `setup` props.

### `Workspace.css` — simpler collapsed rule

- Replace the overlay/peek/reveal block (the `.workspace__body_collapsed .workspace__sidebar` absolute
  overlay, the `:hover ~` peek rules, and the `.workspace__sidebar-reveal` / `:hover` / `:focus-visible`
  rules) with one rule:

  ```css
  .workspace__body_collapsed .workspace__sidebar {
      display: none;
  }
  ```

- Keep `.workspace__body { position: relative; }`? It's no longer needed for an overlay; drop it back to
  the original (or leave it — harmless). The plan drops the now-unneeded `position: relative`.

### `EditorPane.css` — unpin the title (item 5)

- `.editor-pane`: add `overflow-y: auto;` (it stays `display: flex; flex-direction: column; height: 100%`).
  This makes the pane the scroll container.
- `.editor-pane__body`: change `flex: 1 1 auto; min-height: 0; overflow: auto;` to `flex: 1 0 auto;`
  (grow to fill but never shrink below content; no internal scroll). Result: a short note fills the
  height (the whole area stays click-to-focus); a long note overflows and the **pane** scrolls, carrying
  the title up out of view.

### End-of-note scroll room (item 4)

- In `src/components/Workspace.css`, change `--g-md-editor-padding` on `.workspace__editor` from
  `4px 16px 8px 16px` to `4px 16px 300px 16px` — ~300px bottom padding inside the editor content (both
  WYSIWYG and Markup modes). Clicking that space focuses the editor with the caret at the end.
- The read-only preview (`.note-preview`) is separate; optionally match it with a `padding-bottom` so
  scrolling a previewed note feels the same. (Nice-to-have; tuned live.)

## Testing

- **`useShortcuts`:** ⌘' (`{key: "'", metaKey: true}`) fires `toggleSidebar`, including while a typing
  surface is focused.
- **`Workspace` (integration):** the top-bar toggle (`aria-label="Toggle notes sidebar"`) toggles the
  `workspace__body_collapsed` class (assert via `document.querySelector('.workspace__body_collapsed')`)
  and persists `localStorage['gravity-notes:sidebar-collapsed']`; ⌘' toggles it too; a `'true'`
  localStorage value starts collapsed. (Replaces the Task-6 "Collapse sidebar" / "Show notes" tests,
  whose affordances are gone.) `afterEach` clears the key.
- **`NoteList`:** existing tests pass once the reverted props are removed from `setup` (no toggle button
  to test anymore).
- **`ShortcutsDialog`:** the per-descriptor render test covers the new ⌘' row automatically.
- **Visual (manual Chromium smoke):** the top-bar toggle, ⌘', the title scrolling away, and the ~300px
  end room (clicking it lands the caret at the end). The title-scroll restructure especially is confirmed
  and tuned live.

## Out of scope (YAGNI)

- Animating the sidebar show/hide.
- A resize handle / draggable sidebar width.
- Remembering editor scroll position per note.
- Preview-mode end padding beyond an optional one-liner.

## Risks & mitigations

- **The outer-scroller restructure (item 5) may fight the editor's own layout.** ProseMirror grows to
  content by default, so the outer scroll should work, but it's the riskiest piece. Mitigation: it's a
  CSS-only change, reversible, and explicitly smoke-tested; if the editor imposes its own scroll, fall
  back to a wrapper that contains title + editor and scrolls them together.
- **⌘' on non-US keyboard layouts** may map to a different `event.key`. Mitigation: ⌘' is the user's
  pick; the toggle button is the always-available fallback.
- **Reverting the `NoteList` toggle must not strand props.** Mitigation: remove the props from the
  interface, the destructure, the JSX, AND the test `setup` together (typecheck catches a miss).

## Implementation order

1. `shortcuts.ts`: `toggleSidebar` action + `mod+'` descriptor; `useShortcuts` tests.
2. `TopBar`: `collapsed`/`onToggleCollapsed` props + the `LayoutSideContent` toggle button.
3. `Workspace` + `Workspace.css`: pass props to `TopBar`, drop the reveal button, simplify the collapsed
   CSS, wire the `toggleSidebar` shortcut; update the Workspace sidebar tests.
4. `NoteList` (+ test setup): remove the toggle button + props + icon imports.
5. `EditorPane.css`: unpin the title (outer scroll) + end-of-note padding via `--g-md-editor-padding`.
6. Full test/lint/build; manual Chromium smoke. Update `CLAUDE.md` roadmap.
