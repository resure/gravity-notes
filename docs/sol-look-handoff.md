# Handoff: Sol on Gravity UI

State as of 2026-10-28, in the `sol-look` worktree and branch. This continues the Claude session
`604520af-a6e7-4d29-8a72-444a8054de6a` and the reference branch's
`sol-design:docs/sol-design-handoff.md`. The editor port and the three restyling branches are already
combined in `sol-look`; integration into `main`, a pull request and publication are outside this
handoff. The main checkout was not changed during this continuation.

## Decisions carried forward

- Keep `@gravity-ui/uikit` for the chrome's components and behaviour. Take Sol's look through
  `src/tokens.css` and `src/gravity.css`; there is no Base UI dependency or `src/ui/` layer.
- Keep app and workspace appearance, including amber/blue/gray accent. Font and text width also
  have per-note overrides, stored in the metadata sidecar. “Default” inherits outward. Accent has
  no per-note override; theme remains app-wide.
- Keep the existing optional note icons: Gravity icons and emoji, with a file glyph when unset.
  The reference's hover-only “Add icon” placeholder was not ported, so its open visibility question
  does not apply here.
- Keep Gravity-specific behaviour where the reference used Base UI: dialog focus and keyboard
  handling, busy destructive confirms, live Settings changes, and the About link to Gravity UI.
  Text-width labels remain “Normal” and “No limit”; “Default” means inheritance.

## What is integrated

- `f856cc8` ports wiki-link chips and text-editor selections across blocks. A chip hides brackets
  and the target part of an alias without changing stored Markdown. The adjacent-caret popup offers
  Open, Change note, Edit text and Unlink. Code blocks do not decorate wiki links.
- Cross-block typing, Backspace/Delete, Enter, copy/cut/paste and Shift-arrow extension keep the
  unselected text. An image/table endpoint, mixed code/text endpoints, or an ending toggle hiding
  children uses whole-block handling. Starting in a collapsed toggle's summary keeps its hidden
  children. Multiline or rich paste still takes two undo steps; single-line paste takes one.
- WebKit uses the temporary editable-root workaround for selection extension, restores focus to
  the start host, and paints with the `gn-cross-blocks` Custom Highlight and clearing repaint nudge.
- `b9ece72` establishes Sol tokens, Gravity recipes, theme attributes, stroke icons and matching
  anti-flash/native window backgrounds. The active accent is applied through `data-accent`; amber
  uses the default token values.
- The dialogs, folder gate, note list, folder rail, top bar and editor shell are integrated through
  `fcb3b9e`, `db0b9de` and `c5ec642`. The gate waits 300 ms before showing an indeterminate bar.
  Note rows are 48px, or 64px with a folder line; both list virtualization and styling use those
  metrics. The folder rail also exposes Trash.
- The 40px top bar centres search on the window, with the save-state orb beside it. Recent
  workspaces and app actions live in the orb menu. The open note's `⋯` / `⌘⇧I` menu combines live
  appearance controls and note actions, including when search filters its list row out.
- `0ed2455` gives Gravity recipes sufficient specificity against component stylesheets loaded
  later. `162c5e1` keeps DropdownMenu group separators as hairlines. Workspace appearance and the
  accent picker remain intact throughout these changes.

## Documentation reconciliation

`CLAUDE.md`'s interrupted changes were checked against the implementation. `AGENTS.md` now describes
the same behaviour, including pre-existing changes it had missed: one-walk snapshots, targeted
watch refresh, the 96 MiB attachment-cache budget, resizable panels, CodeMirror source editing and
per-note undo restore. The watcher documentation was corrected to exclude dotfiles, including
dot-named Markdown files, as the implementation and its Rust test do.

`README.md`, `docs/architecture.md` and `docs/shortcuts.md` describe the current Sol/Gravity chrome,
settings layers, menus and editor behaviour. The old README screenshots are explicitly labelled as
the earlier interface; they have not been replaced with unverified images. The parity and undo
proposals now distinguish resolved work from their historical plans: partial cross-block editing
and CodeMirror source tooling have landed; block-editor undo resumes for eligible notes, while
source-note history and history transfer between modes remain open.

## Documentation verification

These checks ran in the `sol-look` worktree against implementation commit `162c5e1` plus the
documentation changes:

| Check                                                                | Result                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm test`                                                           | 63 files, 1471 tests passed                                 |
| `npm run typecheck`                                                  | Passed                                                      |
| `npm run lint`                                                       | Passed with 0 errors and 468 warnings                       |
| `npm run format:check`                                               | Passed                                                      |
| `npm run build`                                                      | Passed                                                      |
| `npm run build:single`                                               | Passed                                                      |
| `git diff --check`                                                   | Passed                                                      |
| `git diff sol-design -- src/components/blockEditor src/wikiLinks.ts` | Empty: the editor and wiki-link helpers match the reference |

Builds retain dependency warnings about browser-externalized Node modules and `eval` in the YFM
cut extension; the regular build also reports large chunks. Lint warnings are still present; this
documentation continuation did not change implementation code. It did not run a fresh
scroll-performance benchmark, Rust build, or signed desktop build.

The existing tests cover chip serialization and actions, cross-block editing and undo, appearance
inheritance and persistence, the orb/note menus, actions on a filtered-out open note, switcher IDs
containing spaces and IME navigation guards. They do not prove WebKit selection painting or visual
geometry: there are no direct runtime regression tests for the highlight/repaint path or the
`beforeinput` fallback.

The source Claude session records Chromium checks of both themes, blue accent, dialogs and menus.
Those are prior-session evidence. The documentation-only continuation at `c560374` could not refresh
visual evidence: the in-app browser was unavailable and the computer-use inventory returned no
browsers or apps. A local Vite server started successfully, but no UI was reachable through the
available automation surface.

## Browser and native-build continuation

The next continuation on 2026-10-28 opened the in-app browser against this worktree's Vite server at
`http://127.0.0.1:5175/`. Testing used a fresh origin's in-browser workspace and disposable notes,
with a 1280 × 900 desktop viewport. It did not open a real notes folder or exercise the Tauri shell.

Fresh browser observations:

- Light and dark themes render, and the theme submenu works with keyboard activation. Amber and
  blue app accents and a gray workspace override apply. Workspace Serif/Wide/Gray and the separate
  app Sans/Normal/Blue settings survive a reload; selecting Default restores inheritance.
- Settings segments have equal widths within each picker. The top bar measures 40px, the search
  control is centred at x=640 in the 1280px viewport, and root/folder note rows measure 48/64px.
  The long Settings descriptions fit, and menu groups use thin separators.
- The open note's actions remain available with no matching search results. Mono/Narrow note
  overrides survive rename, move into a new folder, and Trash → Restore. The move picker disables
  the current folder and accepts a folder name containing spaces.
- Wiki-link Change note selects an existing target and retains its alias. Edit text changes the
  displayed alias; Unlink retains the displayed words, and Undo restores the chip. The source
  surface retains literal `[[Target|linked note]]` Markdown. `[[Not a chip]]` in a code block stays
  undecorated.
- Forward Shift-Down selection spans two text blocks. Replacing the suffix of `Alpha text` and the
  prefix of `Beta text…` produces `Alpha Xext…`, retaining the unselected text and wiki chip. Undo
  restores both original blocks. Deleting a whole cross-block range and undoing also restores it.
  The selection paint was inspected in this browser; the full desktop matrix below remains open.

The source-mode transition exposed a React development warning: the shared `surface` props spread
included `key`. `BlockEditorBody` now passes `key={sessionId}` explicitly to both source surfaces
and the Suspense fallback, retaining the per-session remount contract. After a fresh reload,
blocks → source → another note → the original note → blocks restores the correct content, with
no new console warnings or errors during that sequence.

After the fix, all 1471 tests in 63 files pass. The 53 focused body/source/pane tests, typecheck,
the normal and single-file frontend builds and file-scoped lint also pass; lint retains three existing warnings.
The full suite still emits existing React `act` warnings. The native app below was rebuilt from
the fresh normal frontend bundle after the fix.

Local screenshots are `/private/tmp/sol-look-light-note-menu.jpg`,
`/private/tmp/sol-look-dark-settings.jpg` and `/private/tmp/sol-look-dark-workspace.jpg`. They are
temporary evidence, not replacement README screenshots.

Native verification used a separate `CARGO_TARGET_DIR=/private/tmp/sol-look-desktop-target`:

- `cargo fmt --check` passed.
- `cargo test --locked --offline --lib` passed all 30 tests, including filesystem confinement,
  snapshots/heads, window assignments and watcher subscriptions.
- The Tauri debug bundle built for arm64 with the dev identity `com.gravitynotes.desktop.dev`,
  without developer signing, notarization or updater artifacts. The app is at
  `/private/tmp/sol-look-desktop-target/debug/bundle/macos/Gravity Notes Dev.app`.

The native app has not been launched or visually accepted. The available computer-use surfaces
provide the in-app browser, with native app automation disabled. Native traffic lights, launch and
resize backgrounds, window routing and the app's WKWebView repaint behaviour still need the
desktop observations below. Browser tests used one workspace, so switching between distinct
workspaces also remains unverified at runtime.

## Remaining desktop acceptance

Run these in the macOS app built from `sol-look`, using a disposable notes folder:

1. In light and dark themes, inspect the 48/64px note rows, preview and folder contrast, accented
   open-note row, centred switch thumb, equal picker segments, lighter dark selected segment,
   border-free raised New button, and inset rounded workspace/move-picker rows. Confirm menu
   separators stay thin and long Settings labels are not clipped.
2. Set app appearance and different workspace overrides, reload and switch workspaces. Confirm
   inheritance and amber/blue/gray accents persist. Set a note font/width, rename and move the note,
   then trash and restore it; its overrides should follow. Enable note icons and check an unset
   note, a Gravity icon and an emoji.
3. Open a wiki-chip popup, change its target/text, unlink it and undo. Confirm the saved file still
   uses literal `[[...]]` syntax and code blocks stay undecorated.
4. Extend a selection across blocks in both directions with Shift-arrows; type, delete, press
   Enter, copy/cut/paste and undo. Collapse it, click elsewhere, change notes and resize the window.
   Confirm highlight and caret paint clear without leftover fragments. Include a collapsed toggle
   at the start and end of the range. This remains the desktop confirmation requested by the
   reference handoff.
5. Confirm native traffic-light alignment, matching launch/resize backgrounds, note/workspace
   windows and `⌘0`. DOM tests and the browser build do not exercise these native surfaces.

Visual/desktop acceptance remains open until these observations are recorded. The reference
branch's old scroll measurements and WebKit geometry checks are not fresh `sol-look` results.
