# Handoff: Sol on Gravity UI

State as of 2026-10-29, in the `sol-look` worktree and branch. This continues the Claude session
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
  children. Accepted plain, rich and internal-block pastes now take one undo step.
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

Native app automation was unavailable to the agent. After receiving the debug bundle and the
desktop checklist below, the user reported “вроде бы норм” on 2026-10-28. This closes manual desktop
acceptance based on the user's confirmation. The agent did not independently observe the native
checks or obtain a separate result for every checklist item. Browser tests used one workspace.

## Repairs after final review

The user approved fixing the confirmed review findings on 2026-10-29. This pass starts from
`11b2fdf`; the original manual acceptance above covers the earlier debug bundle.

- Cross-block paste decodes and validates the effective clipboard content before changing the
  note. Accepted plain, rich and internal blocks replace the range in one Undo/Redo transaction,
  preserving unselected head/tail text, inline formatting and hidden toggle children. Deferred
  clipboard or attachment failures do not delete the range.
- Internal text-block clipboard HTML is redecorated after sanitation, preserving atomic wiki
  chips and their hidden literal Markdown delimiters. Table cells keep their previous directly
  editable Wiki text; the repair does not extend atomic chips into that separate editing surface.
- Fallback caret measurement uses whole graphemes across inline nodes, with `<br>` separating
  text runs. HTML splitting also snaps invalid programmatic ranges within their original run.
  Chunk pruning avoids measuring every character in ordinary fallback geometry.
- The wiki-link tip remeasures when Change note expands or its results change, flips above the
  chip as needed, caps its height and keeps the keyboard-highlighted result visible.
- Copy link uses the shared native/browser clipboard adapter and reports a failed copy. Rename
  from the open-note menu leaves preview before focusing its editable title.
- Ambiguous root notes emit `[[/Shared]]`; the explicit root form resolves exactly. Following
  a missing explicit root link creates the addressed note, including a valid nested parent path.
  Unsafe, reserved or name-changing paths report an error before any note or folder is created.
  A fresh preflight opens an exact note that appeared since the last refresh and rejects a folder
  occupying the target `.md` path. If creation still returns a different filename, an error names
  the retained file instead of reporting that the exact target was created.
  Bare-title and ordinary `Folder/Note` behaviour stays unchanged.
- Picker option IDs use fixed-width UTF-16 escapes, so distinct Unicode paths cannot share an
  `aria-activedescendant` target. Keyboard actions continue to use the raw keys.

Independent targeted checks caught and repaired a missing root-qualified link still using
same-folder creation, grapheme normalization moving across a preceding `<br>`, and a popup cap
lost when filtering produced the same height. The final native review additionally caught exact
root creation accepting a uniquified collision and an unrequested expansion of table chip behaviour.
The latter expansion was removed, retaining existing direct table editing; the table popup's old
Unlink/edit no-op is inherited from `main` and remains outside these repairs.
Fresh Chromium probes exercise ArrowDown → Enter with emoji, ZWJ and combining marks, including
the `<br>` cases. These are browser observations, not a fresh WKWebView acceptance run.

Exact-path creation remains subject to external filesystem races: the existing `NoteStore.create`
API uniquifies filenames and does not atomically reserve a requested name. A collision after the
preflight can still create and open a suffixed note before the error is reported; that note is kept
to avoid deleting possible concurrent edits. The preflight does not exclude a later external write
between the filesystem backends' own filename probe and write. Resolving that boundary requires a
separate storage contract change.

The earlier review's optional cleanup concerns remain separate: duplicated Trash confirmation,
an unused appearance layout variant and literal Gravity shadow/veil values outside `tokens.css`.
Selection painting still scans the unselected document prefix; its application latency remains
unmeasured. No storage file, sidecar field, dependency or app identity was added by this repair.

Final verification after the collision fix and table-scope correction:

| Check                          | Result                               |
| ------------------------------ | ------------------------------------ |
| `npm test`                     | 67 files, 1596 tests passed          |
| `npm run typecheck`            | Passed                               |
| `npm run lint`                 | 0 errors, 518 warnings               |
| `npm run format:check`         | Passed                               |
| `npm run build:single`         | Passed                               |
| `npm run build`                | Passed; normal bundle used for Tauri |
| Tauri arm64 debug `.app` build | Passed, offline and locked           |
| `git diff --check`             | Passed                               |

The same dependency/chunk warnings and existing React `act` warnings remain. Independent closing
checks passed for paste, popup geometry, graphemes and Workspace actions, including a fresh
Chromium table-editing probe and exact-path collision probes. They cover the repaired paths rather
than a new review of the entire application. Logs, the final source manifest and local PR draft are
under `/private/tmp/sol-look-repairs-20261029/`; no PR was published.

The rebuilt app is `/private/tmp/sol-look-repairs-20261029/Gravity Notes Dev.app`, using the same
dev bundle identity, without developer signing, notarization or updater artifacts. Restart this
bundle for the follow-up manual pass. The agent did not run the repaired app through WKWebView;
the earlier manual acceptance does not verify these later editor changes.

On 2026-10-29 the user launched this repaired bundle and reported that it looked fine, with note-list
scroll performance as the remaining concern. This is general hands-on acceptance, without a
separate result for each checklist item.

## Note-list scroll continuation

The scroll pass starts from `9fb3bcd`. The virtualizer's state previously lived in `NoteList`, so
every visible-range change also executed the toolbar, sort control, closed menus and whole-list
selection lookups. `NoteViewport` now owns that state. The parent retains note actions and selection;
the child notifies it after rows mount so an imperative focus request still lands on the new row.
The selected row and open menu/icon anchors remain mounted outside the visible range. Row heights,
overscan, DOM markup and styling are unchanged.

A production React profiling bundle of the actual component was compared with the saved pre-change
bundle in isolated headless Chromium profiles. The table gives medians of three real browser scroll
gestures, each moving 12,000px at 6,000px/s through 10,000 synthetic notes with icons and mixed 48/64px
rows, using Chromium's 4x CPU slowdown:

| Measurement                          | Before | After  |
| ------------------------------------ | ------ | ------ |
| Outer `NoteList` render executions   | 122    | 0      |
| React render duration across commits | 159 ms | 80 ms  |
| Main-thread task time across gesture | 605 ms | 466 ms |
| Mounted rows at the end              | 33     | 33     |
| Row render executions during gesture | 214    | 214    |

Additional 120-frame scroll runs covered 1,000/10,000 notes, icons on/off and CPU rates 1x/4x.
Their p95 frame interval stayed around 16.7ms before and after; total task timing was noisier,
including a slower unthrottled no-icons result. These measurements demonstrate reduced React work,
not a measured native FPS improvement. They do not profile the user's folder or WKWebView.
The fixture, build/measurement scripts, CPU profiles and raw results are under
`/private/tmp/sol-list-scroll-20261029/`.

Five regressions use a bounded 240px viewport and the real virtualizer. They cover note/file
windowing, scroll leaving the toolbar untouched, focus into an unmounted row and subsequent
keyboard navigation, retained popup anchors and filtering, and height/order changes. The toolbar
regression fails against the previous component with two extra sort-control renders and passes
with zero. All 82 new and existing NoteList tests pass. A fresh Chromium probe also confirms
`focusRow` for note 2000, ArrowDown, and the 560,000px to 480,000px total-height transition when folder
lines are disabled. Independent focused code verification found no defects in the lifecycle move.

The full suite passes 1601 tests in 68 files. Typecheck, formatting, normal/single-file frontend
builds and the offline, locked arm64 Tauri debug build pass; lint reports 0 errors and the same
518 warnings. The final profiling fixture is byte-identical to the measured optimized fixture.
The new app is `/private/tmp/sol-list-scroll-20261029/Gravity Notes Dev.app`, with the existing dev
identity and without developer signing, notarization or updater artifacts. Close the older running
dev app before opening this one. Manual scroll acceptance in WKWebView remains pending.

## Block drag continuation

On 2026-10-29 the user reported that a dragged block tilts at its original position and that a
drop fails after scrolling. This pass starts from `5952433` and retains the note-list optimization.
The tilt was an explicit `rotate(2deg)` on the source `.block.dragging`, rather than on its drag
image. The source now stays upright with reduced opacity, without the lifted background/shadow.

Previously only individual blocks accepted dragover/drop. Gaps could reject a drop while leaving
the old indicator visible. Native Chromium probes also reproduced cancelled drops when scrolling
or moving across child elements changed the browser's current drag destination before release.
The root now captures internal `dragenter`, `dragover` and `drop`. Accepting `dragenter` is necessary
for the reproduced transition: root dragover/drop handling alone still failed it. Geometry is
resolved from the current visible block rectangles, including the left gutter, inter-block gaps
and space below the final block; a stale event target or indicator does not choose the destination.
The pane bounds reject drops outside the editor viewport. Scroll updates the indicator under the
last pointer position, and the edge scroller stops on completion, outside-editor dragover, hiding or
unmounting. Deferred source styling is cancelled on early drop/end and unmount, preventing a
completed drag from becoming active again. External-file handling remains covered by its existing
tests.

Six DOM regressions cover a 25px scroll with a stationary pointer and stale event target, gutter/
bottom gaps, early drop/end, viewport rejection, selected subtrees and one Undo/Redo, and teardown.
On a byte-verified copy of `5952433` they give five failures and one pass. Focused independent
verification of the repaired lifecycle found no defects.

Fresh Chromium probes use actual mouse-driven HTML drag events, a translated scrolling pane and
the production editor bundle. A 40-block note passes direct-body drop, manual 48px scrolling,
gutter/gap drops and edge autoscroll (603px). Every case produces one change, all 40 unique blocks
survive, the source transform stays `none`, and no dragging state remains. A 250-block note also
passes a 1008px edge scroll with its lazily mounted source handle retained and all 250 unique blocks
preserved. The failing browser traces and repaired results, fixture and scripts are under
`/private/tmp/sol-block-drag-20261029/`; these are Chromium observations, not WKWebView acceptance.

Verification passes 1607 tests in 69 files, typecheck, formatting, both frontend builds and the
offline, locked arm64 Tauri debug build. Lint retains 518 warnings with no errors. The six final
drag regressions also pass after the explicit `dragenter` assertion was added, and the same final
test file retains five failures on the byte-verified baseline. The new bundle is
`/private/tmp/sol-block-drag-20261029/Gravity Notes Dev.app`, with the existing dev identity and
without developer signing, notarization or updater artifacts. Close the earlier dev app before
opening this one. Manual drag-with-scroll acceptance in WKWebView remains pending.

## Desktop acceptance checklist

Accepted by the user on 2026-10-28. Retain these checks for future desktop regressions, using a
disposable notes folder:

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

The user's acceptance is manual evidence. The reference branch's old scroll measurements and
WebKit geometry checks are not fresh `sol-look` measurements. Final branch review and PR preparation
follow this acceptance; merging and publication remain separate actions.
