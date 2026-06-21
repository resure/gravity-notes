# UX Polish Batch — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** A batch of nine small-to-medium UX/theming items from the README TODO, on the
  `remove-tabs-nvalt` branch. Follows the in-editor title field and the ⌘J/⌘K navigation work. Most are
  isolated CSS/logic tweaks; the collapsible sidebar is the one medium feature.

## Context

Nine independent items, each grounded in the current code:

- **List date** is `formatNoteDate` in `src/components/NoteList.tsx` (today → locale time; this year →
  "Jun 20"; else full date).
- **Top bar** (`src/components/TopBar.tsx` + `.css`) has a left folder-zone spanning `--sidebar-width`
  and a main zone (search + save + theme + help).
- **Theme colors** live in `src/index.css` — per-theme overrides under `.g-root_theme_light` /
  `.g-root_theme_dark` (brand, selection, link). Markdown/YFM styles are imported in `src/main.tsx`.
- **Editor typography** (line-height, list markers, checklist spacing) is in
  `src/components/EditorPane.css`.
- **Save** is `FileSystemNoteStore.save` (`src/storage/fileSystemStore.ts`): writes
  `stripTrailingNewlines(content) + '\n'`; `get` strips trailing newlines so the editor round-trips
  with no save-on-open. `rename` copies content the same way (recently aligned to `+ '\n'`).
- **Sidebar** is `.workspace__sidebar` in `Workspace` (`src/components/Workspace.tsx` + `.css`), a
  fixed-width flex column holding `NoteList`; `NoteList`'s toolbar row (`.note-list__toolbar`) holds the
  sort `Select` + "New" button.

## Goal

Ship the nine items without regressing the editor, autosave/round-trip, nav, search, or theming.

### Success criteria (per item)

1. **List time** — today shows 24-hour `HH:mm`; any other day shows `DD.MM.YY`.
2. **Top-bar layout** — the search box starts at the far-left edge and fills the width; the folder
   button sits at the right with theme + help.
3. **Link color** — links render in a darkish amber (Bloomberg-ish), not black/grey, in both themes.
4. **Collapsible sidebar** — a toolbar toggle collapses/pins the sidebar; while collapsed the editor
   fills the width and a left-edge affordance reveals the sidebar as a hover **overlay**; the state
   persists across reloads.
5. **Checklist spacing** — checklist rows indent like dashed-list rows; the checkbox is vertically
   centered with its first text line.
6. **Line height** — the editor body line-height is ~1px taller (1.2 → 1.25).
7. **Trailing blank line** — each saved `.md` file ends with one blank line; the editor still
   round-trips with no save-on-open churn.
8. **Code blocks (dark)** — code/`pre` text is a readable foreground color in the dark theme.
9. **Dark background** — the dark base background reads as neutral grey, not warm.

## Decisions (with rationale)

- **One batch spec, sequenced plan.** The items are small and mostly independent; a single spec with a
  per-item section (precedent: the earlier UX-polish spec) keeps them together. The plan orders them so
  the layout (2) and sidebar (4) — which share `Workspace`/`TopBar` — land adjacently.
- **Sidebar model (per the user): hover-to-open + a pin toggle.** A toggle button **inside the sidebar
  toolbar** flips pinned↔collapsed. While collapsed, a slim **left-edge button** reveals the sidebar as
  an absolute-positioned **overlay** on hover (peek), re-hiding on mouse-leave; clicking the toolbar
  toggle while peeked re-docks it. Overlay (not push) keeps the editor width stable during a peek. State
  persists in `localStorage` (a global UI pref, like the theme).
- **Trailing blank line via a shared `canonicalBody()`.** `save` and `rename` both write
  `stripTrailingNewlines(content) + '\n\n'`. `get` keeps stripping trailing newlines, so the editor
  loads the same string it serializes → no spurious save-on-open. One helper avoids drift.
- **Colors are tuned live.** The amber link shade (3), the neutral dark grey (9), and the dark
  code-block color (8) are picked in `index.css` and refined against the running app (the user smoke-
  tests); the spec fixes the _intent_ and the _variables_, not exact hex values that only read right in
  the browser.
- **Keep the bare CSS tweaks minimal and local** (5, 6) — adjust the existing `EditorPane.css` rules,
  no structural change.

## Detailed design

### 1. List time format — `NoteList.tsx`

Rewrite `formatNoteDate(ts)`:

- Today (same `toDateString()` as now) → `HH:mm` 24-hour, e.g. via
  `d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})` (or manual
  zero-padded `getHours()/getMinutes()` for locale-independence — the implementer picks the simpler one
  that yields 24h).
- Otherwise → `DD.MM.YY` zero-padded: `${dd}.${mm}.${yy}`. Drop the "this year → short month/day" branch.
- Empty/0 timestamp → `''` (unchanged).

### 2. Top-bar layout — `TopBar.tsx` + `.css`

- Remove the `.topbar__folder-zone` (the sidebar-width left block) and move the **folder button** into
  the right control cluster, before the theme switcher: `[search ........] [save] [folder] [theme]
  [help]`.
- The search box becomes the full-width hero from the left: `.topbar__main` (now the only zone) spans
  the bar; its left padding aligns with the workspace edge rather than the editor content. Keep the save
  label adjacent to the right controls.
- Update `.topbar` so it's a single flex row; drop the `--sidebar-width` left zone and its right border.
  (The sidebar's own divider remains below in `workspace__body`.)

### 3. Link color — `index.css`

Override the link variables under both theme roots to a darkish amber:

```css
.g-root_theme_light { --g-color-text-link: #c2650f; --g-color-text-link-hover: #9e520c; --g-color-text-link-visited: #8a4a12; }
.g-root_theme_dark  { --g-color-text-link: #e08a2b; --g-color-text-link-hover: #f0a050; --g-color-text-link-visited: #c2752a; }
```

(Starting shades — slightly brighter in dark for contrast; tuned live. These replace the current
black/white link vars.)

### 4. Collapsible sidebar — `Workspace.tsx`/`.css` + `NoteList.tsx`

**State.** `Workspace` owns `collapsed: boolean`, initialized from `localStorage['gravity-notes:sidebar-collapsed']`
and written back on change. A `toggleCollapsed()` flips it.

**Toolbar toggle (pin).** `NoteList` gains `collapsed: boolean` + `onToggleCollapsed: () => void`; it
renders an icon button in `.note-list__toolbar` (beside the sort `Select` + "New"). Icon/label reflects
state (e.g. a "collapse to left" vs "pin" affordance). Clicking it calls `onToggleCollapsed`.

**Layout + peek.**
- **Docked** (`!collapsed`): today's layout — `.workspace__sidebar` (width `--sidebar-width`) beside
  `.workspace__editor`.
- **Collapsed**: `.workspace__sidebar` leaves the flex flow (the editor fills the width). A slim
  left-edge **reveal button** (`.workspace__sidebar-reveal`, a real `<button>` ~8px wide, full height,
  `aria-label="Show notes"`) is rendered. On **hover/focus** of that button — or of the sidebar overlay
  itself — the sidebar shows as an **overlay**: `position: absolute; left: 0; top/bottom: 0; width:
  var(--sidebar-width); z-index` above the editor, with a drop shadow and a slide-in transition. On
  `mouseleave` of the overlay it hides again. The reveal button is mouse+keyboard accessible (focusing
  it opens the peek; the toolbar toggle inside then pins).
- A peeked sidebar shows the same `NoteList` (so its toolbar toggle is reachable to re-dock).

**Interaction summary:** docked → toggle → collapsed; collapsed → hover edge → peek overlay; peek →
toggle → docked; peek → mouse-leave → hidden (still collapsed). Persisted across reloads.

This is presentational state in `Workspace` + CSS; `NoteList` stays a pure list that receives the
toggle. No change to selection/nav.

### 5. Checklist spacing — `EditorPane.css`

- Reduce the checklist row's left indent so it matches the dashed (bulleted) list indent. The editor
  renders checklist items as `<li>`s containing a `.g-md-checkbox`; the extra indent comes from the
  checkbox box + its margins vs. the `::marker` dash. Adjust the checklist `<li>` / `.g-md-checkbox`
  left spacing (e.g. negative margin or reduced padding-left) to align the text start with bulleted
  rows.
- Vertically center the checkbox against the first text line: set the checkbox input's vertical
  alignment / margin-top so its center matches the line's cap height (the current input sits slightly
  high/low). Exact px tuned against the running editor.

### 6. Line height — `EditorPane.css`

Change the editor body line-height from `1.2` to `1.25` in the two rules that set it
(`.editor-pane .g-md-editor.ProseMirror.yfm` and its `:where(p, li)`), an ~1px increase at the base font
size.

### 7. Trailing blank line — `fileSystemStore.ts`

- Add a module helper `canonicalBody(content: string): string` returning
  `stripTrailingNewlines(content) + '\n\n'`.
- `save` writes `canonicalBody(content)` (was `… + '\n'`).
- `rename`'s copy writes `canonicalBody(content)` (keep both paths producing the same canonical form).
- `get` is unchanged (`stripTrailingNewlines`), so the editor loads the same string it serializes — no
  save-on-open. Conflict baselines (mtime) are unaffected; autosave is debounced, so re-writing the same
  bytes never fires spuriously.

### 8. Code blocks in dark — `index.css` (or a small editor-scoped rule)

Fix the washed-out/incorrect code text color in the dark theme. Target the YFM/editor code selectors
(inline `code` and fenced `pre code`, both in the WYSIWYG body and the read-only `.yfm` preview) and set
a readable foreground under `.g-root_theme_dark` (e.g. `--g-color-text-primary` or an explicit light
grey), leaving the code-block background as-is. Exact selector + color confirmed against the running app.

### 9. Dark background → grey — `index.css`

Under `.g-root_theme_dark`, retint the base background(s) toward neutral grey: override
`--g-color-base-background` (and, if they inherit the warm cast, the adjacent surface vars such as
`--g-color-base-generic` / float/modal backgrounds) to a neutral dark grey. Verify the sidebar, editor,
top bar, dialogs, and the focused-row tint stay coherent. Exact grey tuned live.

## Testing

- **Unit (`NoteList`):** `formatNoteDate` — today → `HH:mm` 24h; another day → `DD.MM.YY`; zero → `''`.
  (Use fixed timestamps; no `Date.now()` reliance in assertions.)
- **Store (`fileSystemStore`):** `save` writes a trailing blank line (raw file ends with `\n\n`); a
  saved-then-`get` round-trip returns the stripped body (no `save`-on-open diff); `rename` produces the
  same canonical `\n\n` ending.
- **Component (`Workspace`/`NoteList`):** the toolbar toggle flips collapsed state; collapsed hides the
  docked sidebar and renders the reveal button; the state restores from `localStorage` on mount.
  (Hover-peek visuals are CSS — assert the collapsed/peek class wiring, not pixel layout.)
- **Visual (manual Chromium smoke):** items 2, 3, 5, 6, 8, 9 and the sidebar peek animation — confirm
  amber links, neutral dark grey, readable dark code, checklist alignment, line-height, the top-bar
  layout, and the peek slide-in. These are tuned live.

## Out of scope (YAGNI)

- A keyboard shortcut to toggle the sidebar (the toolbar button + focusable reveal button suffice).
- Animating list rows / remembering scroll across collapse.
- Per-note or per-folder sidebar state (it's a global UI pref).
- Reworking the YFM code-block theme beyond the text-color fix.

## Risks & mitigations

- **Dark-grey retint bleeding into surfaces.** Overriding base background can leave panels mismatched.
  Mitigation: change the base var first, smoke-test every surface, add the adjacent surface vars only if
  needed.
- **Trailing `\n\n` re-introducing save-on-open.** Mitigation: `get` strips trailing newlines, so the
  loaded string equals the serialized string; covered by the round-trip store test.
- **Sidebar overlay z-index / focus.** The peek overlays the editor; ensure it sits above the editor and
  that focus/hover both open it (a11y). Mitigation: real `<button>` reveal + `mouseleave` hide; covered
  by the wiring test + manual smoke.
- **Checklist/code selectors are deep in YFM CSS.** Exact selectors/values may need runtime inspection.
  Mitigation: these are explicitly live-tuned; the spec fixes intent + file, the smoke test confirms.

## Implementation order

1. `NoteList.formatNoteDate` + tests (1).
2. `fileSystemStore` `canonicalBody` + save/rename + round-trip tests (7).
3. `index.css` theme tweaks — links (3), dark code (8), dark grey background (9).
4. `EditorPane.css` — line-height (6) + checklist spacing/alignment (5).
5. `TopBar` layout — search-left + folder-right (2).
6. Collapsible sidebar — `Workspace` state/persistence + overlay CSS + `NoteList` toggle (4) + tests.
7. Full test/lint/build; manual Chromium smoke across all nine. Update `CLAUDE.md` roadmap.
