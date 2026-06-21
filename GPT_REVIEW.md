# GPT Project Review

Review date: 2026-06-22

Scope: source, tests, configuration, CI, and docs for the local-first Markdown notes app. I did not change application code while producing this review.

Overall, the project is in good shape for a small local-first app. The strongest parts are the clean `NoteStore` abstraction, focused storage tests, thoughtful keyboard navigation, and the deliberate editor architecture that keeps keystrokes out of React state. The main improvement area is not broad architecture; it is tightening the note lifecycle around autosave, navigation, deletion, folder changes, and external file changes so user edits are never silently lost.

## Highest Priority Findings

### High: `beforeunload` can fail to warn about unsaved edits

`useNotes` attempts to flush and then decide whether to show the browser's unsaved-changes prompt:

- `src/hooks/useNotes.ts`: `onBeforeUnload` calls `void flush()` and then checks `pendingRef.current || conflict`.
- `src/hooks/useNotes.ts`: `flush()` clears `pendingRef.current` before the first awaited disk write.

Because async functions run synchronously until their first `await`, `void flush()` can set `pendingRef.current = null` before the `beforeunload` handler checks it. If the browser navigates away before the async save finishes, the prompt may not appear and the latest edit can be lost.

Suggested fix: track "has unsaved edits" separately from the in-flight save payload, or have `flush()` expose an `isFlushing`/`flushPromise` state that `beforeunload` treats as unsafe. The handler should prompt whenever there was pending content at the start of unload or an in-flight flush has not confirmed success.

Suggested test: edit a note, dispatch `beforeunload`, make `store.save` hang or reject, and assert that `event.returnValue` is set.

### High: deleting the active note drops debounced edits

`open`, `create`, `rename`, and `close` all flush pending edits before changing note lifecycle state. `remove` does not:

- `src/hooks/useNotes.ts`: `remove()` calls `store.remove(id)` first.
- `src/hooks/useNotes.ts`: if the removed id matches `pendingRef.current?.id`, the pending edit is discarded.

So a user can type, delete the active note within the 500 ms debounce window, and lose the unsaved body with no prompt.

Suggested fix: call `await flush()` before deleting, then either delete after a successful save or explicitly warn when the active note has pending/conflicted edits. If the product intent is "delete means discard", the dialog should say that unsaved edits will be discarded.

Suggested test: open `A.md`, call `edit('new body')`, immediately call `remove('A.md')`, and assert the behavior is intentional.

### High: changing folders can lose unsaved edits

`App` wires folder changes directly to `folder.forgetFolder()`, which unmounts `Workspace`. On unmount, `useNotes` only clears the autosave timer:

- `src/App.tsx`: `onChangeFolder={() => void folder.forgetFolder()}`.
- `src/hooks/useNotes.ts`: the cleanup effect clears `timerRef` but does not flush `pendingRef`.

That makes the folder button another path where edits inside the debounce window can disappear.

Suggested fix: route folder changes through `Workspace`/`useNotes` so pending edits are flushed or the user is asked to confirm. A simple first step is exposing a `hasUnsavedChanges` boolean from `useNotes` and blocking folder changes while `saveState` is `saving`, `error`, or `conflict`.

Suggested test: render `Workspace`, edit a note, click the folder button before the timer fires, and verify either the edit is saved or a confirmation is required.

### High: async save failure can overwrite newer edits

`flush()` snapshots the current pending edit, clears `pendingRef`, and restores the snapshot if `store.save` fails:

- `src/hooks/useNotes.ts`: `const pending = pendingRef.current; pendingRef.current = null;`
- `src/hooks/useNotes.ts`: catch block assigns `pendingRef.current = pending`.

If the user types again while the disk save is in flight, `edit()` writes a newer value into `pendingRef`. A later save failure restores the older snapshot over the newer edit. Even on success, the old flush can set `saveState` to `saved` while a newer pending edit is waiting for its debounce timer.

Suggested fix: serialize flushes per note or version pending edits with a monotonically increasing sequence number. On failure, restore the failed payload only if no newer pending edit exists; otherwise keep the newer edit and surface the failure without regressing the buffer.

Suggested test: use a deferred `store.save`, call `edit('v1')`, start `flush`, call `edit('v2')`, reject the save, and assert `v2` remains pending.

### High: closing or navigating during a conflict can discard local edits

The conflict banner gives explicit resolution actions, but other navigation paths can still clear the conflict:

- `src/hooks/useNotes.ts`: `open()` documents that navigating away from a conflict abandons unsaved edits and then clears conflict state.
- `src/hooks/useNotes.ts`: `close()` calls `flush()`, then clears `pendingRef`, `note`, `conflict`, and active metadata.
- `src/components/Workspace.tsx`: Escape in an empty search box calls the close path through `closeFromSearch()`.

If `flush()` detects or re-detects a conflict, `close()` can still clear the pending edit afterward. Users can therefore leave a conflicted note without choosing Reload, Keep mine, Save as copy, or Discard.

Suggested fix: block `open()`/`close()` while `conflict` is set, or route those paths through an explicit confirmation. At minimum, `close()` should not clear `pendingRef` or `conflict` when `flush()` returns a conflict state.

Suggested test: create a conflict with pending local edits, trigger close/search Escape or open another note, and assert the conflict remains recoverable.

### High: overlapping note opens can leave the editor on the wrong note

Fast browsing fires `open()` calls without cancellation or generation checks:

- `src/hooks/useNoteNavigation.ts`: `browse(id)` always calls `openRef.current(id)`.
- `src/hooks/useNotes.ts`: `open(id)` awaits `flush()`, then `store.get(id)`, then mutates `note`, `baselineRef`, `sessionId`, and active metadata.

A slow `store.get()` for an earlier row can complete after a later `open()` and replace the editor with stale content. This is especially plausible because arrow-key navigation and `mod+j`/`mod+k` preview notes immediately.

Suggested fix: add an `openGenerationRef` in `useNotes`; increment it at the start of each open and ignore results from older generations. Also short-circuit `open`/`browse` when `id === activeId` to avoid unnecessary reloads and editor remounts.

Suggested test: make `store.get('A.md')` resolve after `store.get('B.md')`, call `open('A.md')` then `open('B.md')`, and assert `B.md` remains active.

### High: external-change detection is skipped while edits are pending

The refocus detector avoids checking disk while the current note has pending edits:

- `src/hooks/useNotes.ts`: the focus/visibility check returns early when `pendingRef.current` is set.

That prevents noisy checks during typing, but it also means an external edit made while the user has unsaved local changes is not reported until the next save attempt. Depending on timing and timestamp granularity, the app may show no conflict banner when the user returns to the tab.

Suggested fix: still call `stat()` on focus when pending edits exist, and set a conflict while preserving `pendingRef`. Longer term, compare content hashes or generations rather than only `lastModified`.

Suggested test: open a note, call `edit()`, mutate the file externally, dispatch focus, and assert the conflict banner appears without dropping the local pending edit.

### High: folder bootstrap has unhandled errors and a race with user actions

`useNotesFolder` assumes IndexedDB and permission calls succeed during the initial effect:

- `src/hooks/useNotesFolder.ts`: the mount effect awaits `loadDirHandle()` and `queryPermission(saved)` with no `try`/`catch`.
- `src/components/FolderGate.tsx`: while state is `loading`, the same "Open notes folder" CTA is shown.

If IndexedDB fails, the app can stay in `loading` or emit an unhandled rejection. If the user picks a folder while the initial load is still running, a late effect result can overwrite `ready` with `needs-folder` or `needs-permission`.

Suggested fix: catch initial load failures, close the loading state, and store a generation/cancel token that is invalidated by `pickFolder`/`forgetFolder`. Consider rendering a real loading state instead of an active folder picker during bootstrap.

Suggested tests: add coverage for `loadDirHandle` rejection, `queryPermission` rejection, and "pick folder while initial load is unresolved".

### Medium: writable streams are not cleaned up on write failure

Several storage write paths open a writable stream and then call `write()` / `close()` sequentially:

- `src/storage/fileSystemStore.ts`: `save()` writes note bodies.
- `src/storage/fileSystemStore.ts`: `writeMetadata()` writes the metadata dotfile.
- `src/storage/fileSystemStore.ts`: `rename()` writes the copied note body.

If `write()` throws, there is no `try`/`finally` or `abort()` path. Depending on browser behavior, the stream may remain locked or the partial write may be committed unexpectedly.

Suggested fix: wrap writable usage in a helper that closes or aborts in failure paths. Add fake filesystem tests where `write()` throws and the next save still works.

### Medium: preview rendering is configured differently from editor rendering

The editor is configured with raw HTML disabled:

- `src/components/EditorPane.tsx`: `md: {html: false}`.

Preview mode renders via a separate `@diplodoc/transform` call and injects the result:

- `src/components/NotePreview.tsx`: `transform(markup).result.html`.
- `src/components/NotePreview.tsx`: `dangerouslySetInnerHTML={{__html: html}}`.

The comment says the editor disallows raw HTML, but that guarantee is only applied to the editor instance. If `transform()` allows or insufficiently sanitizes raw HTML by default, a pasted or externally edited note could render unexpected HTML in preview.

Suggested fix: explicitly configure the preview transformer with the same raw-HTML policy as the editor, or add a sanitizer step. Add a regression test with `<img onerror=...>` and `<script>` content that asserts unsafe HTML is escaped or removed.

### Medium: metadata writes are non-atomic and failures leave UI diverged from disk

Folder metadata controls sort, pins, created timestamps, and active note:

- `src/storage/fileSystemStore.ts`: `writeMetadata()` writes JSON directly to `.gravity-notes.json`.
- `src/storage/fileSystemStore.ts`: `readMetadata()` treats corrupt JSON as fresh defaults.
- `src/hooks/useNotes.ts`: `persistMetadata()` updates React state before `store.writeMetadata(next)` completes.

A crash during metadata write can corrupt the dotfile; the next load silently resets all folder state. A normal write failure leaves the UI optimistic while disk still has old metadata.

Suggested fix: write metadata through a temporary sidecar and replace as safely as the File System Access API allows. In `persistMetadata`, either roll back on failure or keep a visible "metadata not saved" state. At minimum, preserve the corrupt metadata file for diagnosis instead of silently replacing all state with defaults on the next write.

Related issue: `refresh()` reconciles metadata in memory but does not write the reconciled metadata back to disk. External deletes can leave ghost pins or a stale active id in `.gravity-notes.json` until some later metadata write happens.

### Medium: rename is copy-then-delete with no rollback

`FileSystemNoteStore.rename()` must emulate rename because the File System Access API has no atomic rename:

- `src/storage/fileSystemStore.ts`: reads old content, creates the new file, writes it, then removes the old entry.

If writing the new file succeeds but deleting the old file fails, the folder contains duplicates. If an unexpected failure happens between operations, metadata may refer to a different id than the files on disk.

Suggested fix: make the failure mode explicit in UI/tests. After a partial failure, refresh from disk and show a recovery toast. Also add tests using a fake directory that throws on `createWritable().close()` and `removeEntry()`.

Related issue: `rename()` has no optimistic concurrency check. Renaming a note that changed externally can copy stale content into the new file name because only `save()` accepts a `baseUpdatedAt`.

### Medium: case-only renames and platform filename rules need attention

`sanitizeTitle()` removes common illegal filename characters, but it does not account for case-insensitive filesystems or Windows reserved/trailing names:

- `src/storage/fileSystemStore.ts`: `rename()` checks `exists(nextName)` before copying.
- `src/storage/fileSystemStore.ts`: `sanitizeTitle()` does not handle `CON`, `NUL`, trailing dots/spaces, or title values already ending in `.md`.

On macOS/Windows, `note.md` to `Note.md` can be treated as a collision or behave inconsistently depending on the browser/filesystem. Titles such as `CON` or names ending in spaces may fail at the browser/filesystem layer.

Suggested fix: normalize filename validation centrally and add platform-oriented tests. For case-only renames, a two-step temporary rename may be required.

Related issue: `create()` creates a zero-byte file, while `save()` canonicalizes even empty bodies to a blank-line-at-EOF shape. `get()` hides the difference, but external tools see inconsistent note files until the first save.

### Medium: initial note loading has no error boundary or toast path

The initial `useNotes` effect loads notes and metadata without a `try`/`catch`:

- `src/hooks/useNotes.ts`: initial effect awaits `Promise.all([store.list(), store.readMetadata()])`.

If listing fails because permissions changed, the directory handle is stale, or a file read throws, the hook can leave the workspace empty with an unhandled rejection.

Suggested fix: catch initial load failures, surface `onError`, and expose a retry/choose-folder path. Add an error boundary around `Workspace` for render-time failures.

### Low: metadata parsing accepts some malformed-but-typed values

`parseMetadata()` filters broad types, but still accepts values such as an empty active id, duplicate pinned ids, and non-finite `created` timestamps because `NaN` is still a number.

Suggested fix: treat `active === ''` as `null`, deduplicate pins, and require `Number.isFinite()` for timestamps.

## UX And Accessibility Findings

### Medium: invisible row action buttons may still be keyboard focus targets

The row menu is hidden with opacity:

- `src/components/NoteList.css`: `.note-list__actions { opacity: 0; }`.
- `src/components/NoteList.tsx`: each row contains a `DropdownMenu` switcher button.

Opacity does not remove controls from the tab order. Keyboard users may tab into invisible menu buttons, and `role="option"` rows containing nested interactive controls are a difficult ARIA pattern for screen readers.

Suggested fix: make row actions visible on focus-within, or move actions outside the `listbox`/`option` pattern. Add keyboard tests that tab through the list and can see/focus the action button.

### Medium: search and icon buttons need stronger accessible names

Several controls rely on placeholders or `title`:

- `src/components/TopBar.tsx`: search uses placeholder text but no explicit `aria-label`.
- `src/components/TopBar.tsx`: folder/help buttons use `title`.
- `src/components/ThemeSwitcher.tsx`: theme button uses `title`.

Placeholders are not a robust accessible name, and `title` is inconsistently announced.

Suggested fix: add explicit `aria-label` values for search, folder selection, help, and theme switching.

### Medium: collapsed-sidebar focus can target hidden content

When the sidebar is collapsed, CSS sets it to `visibility: hidden` until peeked:

- `src/components/Workspace.css`: collapsed sidebar uses `visibility: hidden`.
- `src/components/Workspace.tsx`: global Escape fallback calls `listRef.current?.focusSelected()`.

That fallback can attempt to focus a hidden row when the sidebar is collapsed but not peeked. The README backlog already mentions ESC behavior with a closed sidebar.

Suggested fix: if the sidebar is collapsed, Escape should either focus search or open/peek the sidebar before focusing a row.

### Medium: filtered search can leave selection on an invisible note

`useNoteSearch` filters the displayed list, but `useNoteNavigation` keeps `selectedId` unchanged. If the selected note is filtered out, the list falls back to a focusable visible row while app state still points at the hidden note.

Suggested fix: when `selectedId` is not present in `filteredNotes`, either clear selection or auto-browse the first visible match. Add tests for selecting one note and then filtering it out.

### Medium: global F2 can start list rename while the editor title is focused

The F2 shortcut is global and allowed while typing. If focus is in the in-editor title, F2 starts renaming the selected list row instead of acting on the focused title field.

Suggested fix: ignore global F2 when focus is inside `.note-title`, or make it select the current title text without opening a second rename surface.

### Low: touch and mobile affordances are incomplete

The app includes `MobileProvider`, but layout and actions remain desktop-first:

- fixed `--sidebar-width: 280px`;
- row actions are hover/selected-driven;
- peek dismissal listens to `mousedown`, not `pointerdown`;
- no responsive breakpoint is visible in the CSS reviewed.

Suggested fix: defer full mobile support if it is out of scope, but make row actions available without hover and use pointer events for overlay dismissal.

### Low: preview transform failures render a blank preview

`NotePreview` catches transform errors and returns an empty string:

- `src/components/NotePreview.tsx`: `catch { return ''; }`.

That makes a malformed note look empty in preview mode.

Suggested fix: show a non-destructive preview error message and keep the editor content intact.

## Performance And Scale

### Medium: list refresh reads every note serially

`FileSystemNoteStore.list()` iterates all directory entries and reads the first 500 bytes of each Markdown file:

- `src/storage/fileSystemStore.ts`: `for await (const handle of this.dir.values())`.
- `src/storage/fileSystemStore.ts`: `await file.slice(0, PREVIEW_SCAN_BYTES).text()`.

For a folder with many notes, refreshes after create/rename/delete and startup can become slow. The current fake filesystem tests do not model large folders or slow file handles.

Suggested fix: consider parallelizing preview reads with a concurrency limit, caching previews by `id` + `updatedAt`, or making previews lazy. Add a test or benchmark with hundreds/thousands of fake files.

### Low: browsing writes active metadata on every preview

The navigation model previews notes immediately:

- `src/hooks/useNoteNavigation.ts`: `browse()` calls `open()`.
- `src/hooks/useNotes.ts`: `open()` persists `metadata.active`.

Holding arrow keys or repeatedly previewing notes can write `.gravity-notes.json` many times. This also increases multi-tab conflict potential.

Suggested fix: consider debouncing active-note metadata writes, or persist active only on committed edit/open if preview persistence is not essential.

## Multi-Tab And External Edit Limitations

These are not necessarily v1 blockers, but they should be documented because this is a local-first app over user-owned files:

- `.gravity-notes.json` is last-write-wins across tabs. Pin/sort/active changes from one tab can overwrite another.
- `create('Untitled')` can race across tabs after `uniqueFileName()` checks for availability.
- Conflict detection relies on `lastModified`; timestamp granularity can miss or overreport changes on some filesystems.
- External file changes are detected only on focus/visibility changes, not while the app remains focused.

Suggested fix: document single-tab expectations for v1. Longer term, use content hashes/generations and file observation APIs where available.

## Test Coverage Gaps

Strong existing coverage:

- `src/storage/fileSystemStore.test.ts` covers CRUD, canonical body shape, conflicts, metadata, and basic rename behavior.
- `src/storage/metadata.test.ts` covers metadata parsing/transforms/order.
- `src/hooks/useNotes.test.tsx` covers active note restore, open/close/create/rename/remove, and conflict resolvers.
- `src/components/Workspace.test.tsx` covers many keyboard navigation and sidebar flows.

Important missing coverage:

- `src/storage/handlePersistence.ts`: IndexedDB save/load/clear, transaction failures, permission wrappers.
- `src/hooks/useNotesFolder.ts`: folder state machine, denied permissions, stored handle recovery, initial-load failures, race with `pickFolder`.
- `src/components/FolderGate.tsx`: unsupported/loading/permission/error states.
- `src/components/NotePreview.tsx`: transform errors and raw HTML behavior.
- `src/App.tsx`: theme/folder wiring and folder-change behavior.
- `useNotes` edge cases: delete with pending edits, folder unmount with pending edits, rejected async save while newer edits arrive, `beforeunload` warning, close/navigate during conflict, external delete/modify while edits are pending, concurrent `open()` ordering, sort/pin persistence.
- Storage failure paths: write-stream failures, partial rename failures, metadata write failures, case-only rename, and malformed metadata values.
- Search/navigation edge cases: selection hidden by filtering, same-note re-open/remount, F2 while the editor title is focused, and collapsed-sidebar Escape behavior.
- Real editor smoke coverage: most component tests mock `@gravity-ui/markdown-editor`, which is appropriate for unit speed but cannot catch integration issues in editor serialization/focus.

Suggested next tests:

1. Add deferred-promise tests for `flush()` races and concurrent `open()`.
2. Add conflict lifecycle tests for close/navigate, external delete, and external changes while local edits are pending.
3. Add `useNotesFolder` tests with mocked IndexedDB and permission methods.
4. Add storage failure-path tests for write errors, partial rename, and metadata failures.
5. Add a `NotePreview` security/escaping regression test.
6. Add one browser-level smoke test for create/edit/save/reload if the project adopts Playwright or similar tooling.

## Tooling And CI

### Medium: `build:single` is not verified in CI

The Vite config includes a special single-file mode and a specific ASCII charset workaround:

- `vite.config.ts`: `mode === 'singlefile' ? [viteSingleFile()] : []`.
- `vite.config.ts`: `esbuild: {charset: 'ascii'}`.
- `.github/workflows/ci.yml`: CI runs normal `npm run build`, but not `npm run build:single`.

If single-file output matters, it should be in CI because it has distinct bundling behavior.

Suggested fix: add `npm run build:single` to CI or remove the script if it is not supported.

### Low: config files are outside TypeScript's include

`tsconfig.json` includes only `src`, so `vite.config.ts` is not covered by `npm run typecheck`.

Suggested fix: add a separate `tsconfig.node.json` or broaden typechecking for config files.

### Low: no coverage script or threshold

The project has a healthy test suite, but no `test:coverage` script or CI threshold. Given the data-loss-sensitive autosave code, coverage around lifecycle edges would be useful.

Suggested fix: add coverage reporting after the lifecycle tests above are in place; avoid enforcing a threshold until the missing critical paths are covered.

## Documentation Gaps

`README.md` explains the v1 concept and storage model, but it lags current behavior:

- keyboard-first nvALT search/create behavior;
- pinned notes and sort modes;
- conflict handling;
- `.gravity-notes.json` sidecar metadata;
- single-file build mode;
- known browser/filesystem limitations;
- single-tab expectation, if that remains the intended v1 stance.

Suggested fix: update README after the lifecycle fixes so docs match the safer behavior.

## Recommended Fix Order

1. Fix `beforeunload`/in-flight flush tracking.
2. Flush or explicitly confirm before delete and folder change.
3. Version/serialize async saves so older failures cannot overwrite newer edits.
4. Block or explicitly resolve close/navigate paths during conflicts.
5. Add generation checks and same-note short-circuiting to `open()`.
6. Harden external-change detection while local edits are pending.
7. Harden and test `useNotesFolder` plus `handlePersistence`.
8. Verify and lock down `NotePreview` raw HTML behavior.
9. Improve metadata write failure handling, writable cleanup, and partial rename recovery.
10. Address accessibility/state drift around row actions, search, filtered selection, F2, and icon buttons.
11. Add missing lifecycle tests and a small browser smoke test.
12. Update README and CI (`build:single` if it is supported).

## Closing Assessment

The codebase is thoughtfully structured and already has much better test coverage than many small local-first apps. The biggest risk is that the most important invariant, "typed text is never lost silently", is not yet consistently enforced across unload, delete, folder change, failed saves, and rapid navigation. Tightening that invariant will give the project a much stronger foundation without requiring a major rewrite.
