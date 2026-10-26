# Handoff: the `sol-design` branch

State as of 2026-10-26. The branch is experimental and has no pull request; `main` is untouched.

## What the branch is

The "Sol" redesign on top of `main`'s block editor (v0.12.0). The app chrome leaves Gravity UI for
[Base UI](https://base-ui.com) primitives in `src/ui/`, styled only by `src/tokens.css`. The target
look is Claude desktop and Things: compact, quiet, a warm neutral ramp, one fixed amber accent. The
block editor also gained wiki-link chips and text-editor behaviour for selections across blocks.

## Direction: keep Gravity UI, take the look

The user's decision (2026-10-26): keep `@gravity-ui/uikit` and restyle it to look like this branch,
rather than merge the move to Base UI. This branch is the visual reference, not the code to merge.

What that means for porting, as a starting point to check rather than a plan:

- **Portable as is.** The editor work does not depend on the UI kit: wiki-link chips, edits and
  ⇧-arrows across blocks, and the WebKit fixes (`src/components/blockEditor/`, `src/wikiLinks.ts`).
  These can go to `main` on their own.
- **Portable as values.** `src/tokens.css` (colours, type scale, radii, shadows, durations) maps onto
  Gravity's theme variables (`--g-color-*`, `--g-text-*`, `--g-border-radius-*`) and per-component
  overrides. The note list's metrics and colours are plain CSS.
- **To redo on Gravity.** Everything in `src/ui/` and the chrome built on it (dialogs, menus,
  toggle groups, switches, the floating-menu material, toasts) must be re-expressed as Gravity
  components with restyling. The dark-mode rules above (raised lighter, fields darker) still apply.
- **Settings model.** The removal of per-workspace appearance and the accent setting is a separate
  choice from the UI kit; decide it on its own.

`CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/architecture.md` and `docs/shortcuts.md` on this branch
already describe the new design system and editor behaviour. This document covers what they do not:
history, verification methods, decisions, and what is still open.

## Commits

Five commits on `main`, in order:

1. `design(sol): the Sol design on Base UI, without Gravity UI` — the design system and the rebuilt
   chrome. Appearance becomes two layers (app, note): per-workspace overrides and the accent setting
   are removed, so a workspace that had its own font, width or a blue/gray accent shows the app
   value.
2. `design(sol): review rounds — note list, panes, menus, emoji icons` — the first review round.
3. `feat(editor): wiki-link chips and text-editor selections across blocks` — the editor work (see
   below), plus small review fixes across the app.
4. `design(sol): second review round — controls, note list, pickers` — today's design fixes.
5. `docs: sol-design handoff` — this file.

The full pre-squash history is on two local branches (not pushed): `sol-design-presquash` (31
commits, before the first squash) and `sol-design-presquash-2` (the 9 commits before this squash).

## Design system

- `src/tokens.css` holds every colour, type size, radius, shadow and duration. Its header states the
  rules. The amber accent is fixed and allowed in exactly six places: focus ring, the pressed
  toggle-group segment, hyperlinks, the sync dot, text selection, and the open note's row in the
  list. Menu and popover highlights stay neutral.
- `src/ui/` wraps Base UI: `Button` (`quiet`, `raised` — only the note list's "+ New" — and
  `filled`), `Dialog`, `Menu`, `Popover`, `Select`, `Switch`, `ToggleGroup`, `Tooltip`, `toast`,
  `Input`, `Progress`, icons. `popup.css` is the one floating-menu material; its positioner sits at
  z-index 1050, above dialogs (1000/1001) and below toasts (1100).
- Dark mode inverts the raised recipe: raised controls go lighter than their surface with a top
  highlight, fields go darker with an inner shadow. Two bugs today came from breaking that rule (a
  pressed segment darker than its track; a raised button with a hairline plus a highlight that read
  as an outline).

## The editor

### Wiki links

- A `[[link]]` renders as one `contenteditable="false"` chip. Its brackets and the `Note|` part of
  `[[Note|text]]` sit in `wiki-hidden` spans: they stay in the text (so caret offsets and the
  serializer are unaffected) but never show. The file still holds the literal `[[...]]`.
- The caret is kept out of chips (`atomAt`, `outsideAtoms`, `keepOutOfAtoms`,
  `moveCaretOutOfAtom` in `caret.ts`).
- With the caret beside a chip, a popup offers Open, Change note (an in-popup note search that keeps
  the link's text), Edit text, and Unlink. Escape returns the caret after the link.
- Code blocks never decorate `[[`.

### Text selections across blocks

Each block is its own `contentEditable`, so the browser cannot edit a selection that spans blocks.
The editor does it:

- `selectionBlockIds()` lists the blocks a selection covers, including the blocks holding its two
  ends even when it covers none of their text (a selection ending at a block boundary still takes
  the break).
- `textSelectionAcross()` splits the ends; `deleteAcross()` and `splitAcross()` make the edit as one
  `setBlocks` call (one undo step). Paths: keydown (Backspace, Delete, Enter, a typed character), a
  `beforeinput` guard for input without keydown (dictation, autocorrect), cut, copy, and paste.
- If an end is an image, a table cell or a collapsed toggle hiding children, whole blocks go.
- Formatting chords (⌘B/I/U/E/K, ⌘⇧S) do nothing across blocks.
- ⇧-arrows extend across blocks (`extendSelectionAcross`).

### WebKit specifics (the desktop app runs WKWebView)

- WebKit clamps a selection to the editing host it started in. `acrossBlocks` makes the editor root
  editable for the call. This is gated to WebKit (`CLAMPS_SELECTION_TO_HOST`, a user-agent check):
  in Chromium the trick dropped focus, and refocusing a block collapsed the selection.
- After the call, focus goes back to the block holding the selection's START, and only if focus left
  the blocks. WebKit collapses a selection onto a focused host that does not contain its start; that
  broke ⇧↑ and ⇧← until today.
- WebKit paints a selection only inside its host. Cross-block selections are painted per block with
  the CSS Custom Highlight `gn-cross-blocks`, and a repaint nudge clears leftover paint.
- `caretRangeFromPoint` hits whatever is on top. The wiki-link popup covers the next line, so a
  missed hit test now falls back to measuring characters (`caretRangeIn` in `caret.ts`).

## How things were verified

- Unit tests: `npm test` (1447 tests), plus `npm run typecheck`, `npm run lint` (0 errors),
  `npm run format:check`, `npm run build`, `npm run build:single`.
- Chromium: the in-app browser against a Vite dev server for the worktree (port 5274).
- WebKit: small Swift programs that open a `WKWebView` on the dev server. They seed a note through
  `IndexedDbNoteStore` with `callAsyncJavaScript`, reload, open the note, then send native events and
  read the DOM back. The scripts lived in `/tmp/sol/` and are not kept. To rebuild one:
  - Keys: `NSEvent.keyEvent` sent with `window.sendEvent`. Arrow keys need
    `[.numericPad, .function]` in the modifier flags; other keys must not carry them.
  - Clicks: call `webView.mouseDown(with:)` / `mouseUp(with:)` directly; `window.sendEvent` with a
    synthetic mouse event never reached the page.
  - Wheel: `CGEvent(scrollWheelEvent2Source:...)` with the continuous and phase fields set, wrapped
    in `NSEvent(cgEvent:)`.
  - Timing: WebKit's `performance.now()` has 1 ms resolution and `requestAnimationFrame` is capped at
    60 Hz, so per-frame cost below 1 ms is invisible.

## Investigations with results

- **Scroll performance in long notes.** No regression found. On a generated 642-block note,
  programmatic and wheel scrolling measured the same on this branch and on `main` (p95 about 18 ms
  per frame in WebKit, forced layout under 1 ms per frame). The comparison is against `main`'s block
  editor, not the pre-v0.12 editor. A `tauri:dev` build runs development React and unbundled Vite,
  which is slower than a release build. If a specific note feels slow, measure that note.
- **"Show note icons does nothing."** The toggle works (verified with real clicks in WebKit). With it
  on, a note without an icon shows only a faint "Add icon" button above the title, on hover, plus
  "Set icon…" in the row ⋯ menu. All icons in the user's vaults are emoji, so legacy Gravity icon
  names are not the cause.

## Decisions and known gaps

- A multi-line or rich paste over a cross-block selection takes two undo steps (delete, then
  paste); a single-line paste takes one.
- Review findings deliberately not applied: unifying the note list's and the top bar's note-action
  menus; removing `useStableAnchor` and the frozen picker rect; removing unused `src/ui` props; the
  `topbar__panes` wrapper. A Codex finding ("a nested confirm's Escape closes Trash") did not
  reproduce.

## Open items

1. **Note icons placeholder.** Decide whether "Show note icons" should show the faint "Add icon"
   button permanently, not only on hover. The user was asked and has not answered.
2. **Check today's visual changes in the desktop app.** They were verified in Chromium and by
   geometry in WebKit only: rows at 48/64 px with brighter preview and folder text, the amber-tinted
   selected row, the centred switch thumb, equal toggle segments with a lighter dark pill, the
   border-free dark "+ New" button, and inset rounded rows in the ⌃R switcher and the ⌘⇧M picker.
3. **Cross-block selection painting.** The user has not yet confirmed that the leftover-paint fix
   works in their desktop build.
4. **Merging.** Nothing is merged or proposed. Per the direction above, the branch is not merged
   whole: the editor work can be ported to `main` first, then the look restyled onto Gravity UI.
