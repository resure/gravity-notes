# Gravity Notes — Code Review (Opus)

An independent, verification-first pass over the codebase. Where a claim could be checked
against the code or a dependency's actual behavior, I checked it rather than asserting it.

A `CURSOR_REVIEW.md` already exists; this report **does not restate it**. It leads with findings
that review missed, calibrates severity/confidence on the overlapping ones, and explicitly
**corrects two claims** (one over-stated, one a non-issue). Overlap is flagged inline.

**Overall:** genuinely well-built for v0.1. The `NoteStore` seam is clean, the editing model
(refs + 500 ms debounce + flush-on-navigate, `sessionId`-keyed remounts) is thoughtful, and the
test suite is real — ~233 tests across 16 files, with strong coverage of storage, metadata, and
navigation. The weak spots are a **broken keyboard shortcut hidden by a misleading test**, a
handful of **save-lifecycle data-loss edges**, and **editor remounts on no-op navigation**.

Severity: 🔴 high · 🟠 medium · 🟡 low. Confidence noted where it isn't certain.

---

## 🔴 1. `⌘⇧;` (Toggle WYSIWYG / Markup) never fires — and its test masks it

**Confidence: high.** This is the headline finding, and it is *not* in the Cursor review.

The global handler matches the shifted binding by `event.key`:

```ts
// src/hooks/useShortcuts.ts:36-41
if (binding.trigger === 'mod') {
    if (
        mod &&
        (binding.shift ? event.shiftKey : !event.shiftKey) &&
        !event.altKey &&
        event.key.toLowerCase() === binding.key.toLowerCase()  // ← compares against ';'
    ) {
```

The binding is [shortcuts.ts:86](src/shortcuts.ts#L86): `{trigger: 'mod', key: ';', action: 'toggleEditorMode', shift: true}`.

On every standard layout (US/UK/etc.), **`;` and `:` share one key** — so when Shift is held,
`KeyboardEvent.key` is **`":"`, not `";"`**. The check `":" === ";"` is false, so the action
never runs. Toggling editing mode is the *only* consumer of `toggleEditorMode`, and the editor is
mounted with `settingsVisible={false}` ([EditorPane.tsx:199](src/components/EditorPane.tsx#L199)),
which hides the toolbar's mode switch. Net effect: **there is no working way to switch to Markup
mode** — yet the help dialog advertises `⌘⇧;` as if it works.

Why the test suite is green anyway — it constructs an impossible event:

```tsx
// src/hooks/useShortcuts.test.tsx:56
press({key: ';', metaKey: true, shiftKey: true});  // key:';' WITH shift can't occur on a real keyboard
```

A real keydown can't have `key: ';'` while `shiftKey: true` on these layouts; it would be
`key: ':'`. The test encodes the bug as the expectation, giving false confidence.

This is a live instance of a lesson already recorded in project memory
(*"macOS ⌘+Shift shortcut gotcha — bind by base key + shift flag, not the shifted char"*) — the
fix the memory prescribes was applied to `⌘⇧P` (a letter, where Shift only changes case, so it
happens to work) but **not** to `⌘⇧;`.

**Fix:** match punctuation chords by physical key, `event.code === 'Semicolon'` (add an optional
`code` to `GlobalBinding`), or accept the shifted alias. **Then fix the test** to dispatch
`{key: ':', code: 'Semicolon', metaKey: true, shiftKey: true}` so it reflects reality. Audit any
future punctuation+Shift binding the same way.

---

## 🔴 2. Save-lifecycle data-loss edges

The editing model is deliberately decoupled from React state (good), but a few paths around the
`pendingRef` + `flush()` machinery can silently drop bytes.

### 2a. Reverting an edit to its original strands a stale pending value
**Confidence: high. Not in the Cursor review.**

`EditorPane` suppresses the change event whenever the editor value equals the *initially loaded*
content, to skip the no-op emitted on open:

```ts
// src/components/EditorPane.tsx:82
if (value !== note.content) {
    onChange(value);
}
```

`note.content` is the content at open and never updates after saves. So this sequence diverges
disk from screen:

1. Open note "hello". `pendingRef = null`.
2. Type "!" → `onChange("hello!")` → `pendingRef = {content:"hello!"}`, 500 ms timer armed.
3. Within 500 ms, delete "!" → editor value is `"hello"` again → `value === note.content` → **`onChange` is not called**. `pendingRef` still holds `"hello!"`, timer still pending.
4. Timer fires → `flush()` writes **"hello!"** to disk.

Editor shows `hello`; disk has `hello!`. They stay out of sync until the next real edit. The
guard meant only to drop the *open-time* no-op also drops a genuine revert-to-original.
**Fix:** gate the no-op only on the first emit (e.g. an `initialized` ref), not on equality with
the original forever.

### 2b. `flush()` failure overwrites keystrokes typed during the await
**Confidence: high. Overlaps Cursor §3 — confirmed, with the precise window.**

```ts
// src/hooks/useNotes.ts:148-157
const pending = pendingRef.current;
if (!pending) return;
pendingRef.current = null;
try {
    const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
    ...
} catch (err) {
    pendingRef.current = pending; // ← clobbers anything edit() set during the await
```

On the success path this is fine (edits during the await set a fresh `pendingRef` + timer and are
preserved). On the **failure** path, `pendingRef` is reset to the pre-await snapshot, discarding
everything typed while `store.save` was in flight. **Fix:** only restore if `pendingRef.current`
is still `null` (i.e., no newer edit landed), or serialize saves behind a mutex.

### 2c. `remove()` deletes before flushing
**Confidence: high. Overlaps Cursor §1 — confirmed.** [useNotes.ts:263](src/hooks/useNotes.ts#L263)
deletes on disk and nulls `pendingRef` with no `flush()` first — unlike `open`/`create`/`rename`/
`close`. Deleting the *active* note inside the debounce window drops its unsaved edits. (Arguably
acceptable since the file is being deleted anyway — but if the user deletes a *different* note
while the active one has pending edits, `remove` doesn't flush the active note either, and the
subsequent `refresh()` → `store.list()` re-reads stale bytes. Flush first.)

### 2d. Folder change / unmount never flushes
**Confidence: high. Overlaps Cursor §2 — confirmed.** `onChangeFolder` wires straight to
`forgetFolder()` ([App.tsx:43](src/App.tsx#L43)) and the `useNotes` unmount cleanup only clears
the timer ([useNotes.ts:400-404](src/hooks/useNotes.ts#L400-L404)) — it does not flush. Changing
folders within 500 ms of a keystroke loses it, with no prompt. **Fix:** `await flush()` before
forgetting, and/or confirm when `saveState !== 'idle'`.

---

## 🟠 3. No-op navigation remounts the editor (caret / scroll / undo loss)

**Confidence: high. Overlaps Cursor (UI) — confirmed, plus a second trigger they missed.**

`browse()` always calls `open()` ([useNoteNavigation.ts:64-71](src/hooks/useNoteNavigation.ts#L64-L71)),
and `open()` always `bumpSession()`s ([useNotes.ts:182](src/hooks/useNotes.ts#L182)), which is the
`key` on `EditorPane` ([Workspace.tsx:330](src/components/Workspace.tsx#L330)) — so it tears down
and rebuilds the ProseMirror instance, losing caret, scroll position, and undo history.

`commit()` already guards this (`if (id === activeId) editorRef.focus()`), but `browse()` does
not. Two real triggers:

- **Clicking the already-open row** → `browseRow` → `onBrowse` → `open` → remount.
- **`⌘J`/`⌘K` at the list ends** — `browseRelative` clamps the index and still calls
  `enterList(target)` even when `target === selectedId`
  ([Workspace.tsx:164-169](src/components/Workspace.tsx#L164-L169)), so pressing `⌘J` on the last
  note (or `⌘K` on the first) remounts the open editor.

**Fix:** short-circuit in `open()` when `id === metadataRef.current.active` (also removes a
needless `store.get` + `writeMetadata` per arrow key), and/or skip `enterList` when
`target === selectedId`.

> Related, lower priority: rapid `open()` calls have **no generation token**, so a slow `store.get`
> for an older note can resolve after a newer one and leave the editor on the wrong note
> (overlaps Cursor §4). Short-circuiting same-note opens shrinks this window but doesn't close it;
> a request-id guard in `open()` would.

---

## 🟠 4. Storage robustness (confirmed; overlaps Cursor — kept brief)

- **Non-atomic rename** — copy → write → `removeEntry` with no rollback
  ([fileSystemStore.ts:174-182](src/storage/fileSystemStore.ts#L174-L182)). A crash after create,
  before delete, duplicates the note; after delete, loses it.
- **Non-atomic metadata write** — `writeMetadata` truncates then writes JSON in place
  ([fileSystemStore.ts:154-159](src/storage/fileSystemStore.ts#L154-L159)); a crash mid-write
  yields invalid JSON, and `readMetadata`'s tolerant parse then silently **resets pins / sort /
  created stamps / active note**. Write to a temp file + replace.
- **Case-only rename is rejected on case-insensitive filesystems** (macOS/Windows) —
  `Note.md` → `note.md` resolves to a different `nextName`, `exists()` finds the same file, and
  it throws `NameCollisionError` ([fileSystemStore.ts:164-171](src/storage/fileSystemStore.ts#L164-L171)).
- **IndexedDB handle never closed on error** — `db.close()` is wired only to
  `transaction.oncomplete` ([handlePersistence.ts:35](src/storage/handlePersistence.ts#L35)); a
  failed transaction leaks the connection. Close in both `oncomplete` and `onerror`/`onabort`.
- **`save()` is check-then-write (TOCTOU)** — the mtime guard
  ([fileSystemStore.ts:112-118](src/storage/fileSystemStore.ts#L112-L118)) is not atomic with the
  write; an external writer between the stat and the `createWritable` is missed. Inherent to the
  FS Access API; document it.

---

## 🟠 5. `NotePreview`: error swallowing, and a security claim I checked and am *retracting*

`NotePreview` renders `transform(markup).result.html` via `dangerouslySetInnerHTML`
([NotePreview.tsx:22-33](src/components/NotePreview.tsx#L22-L33)).

**I verified `@diplodoc/transform`'s defaults before flagging XSS, and the XSS concern does not
hold.** In `node_modules/@diplodoc/transform/lib/md.js`: `allowHTML` defaults to `false`
(markdown-it `html:false`, so raw HTML is escaped, not parsed) and `needToSanitizeHtml` defaults
to `true` (output runs through `sanitize-html`). With no options passed, the preview is HTML-safe
by default. **Do not "harden" this line — it's fine.** (Belt-and-suspenders: keep raw HTML
disabled if you ever pass options.)

The real, smaller issues here:

- 🟡 **Errors are swallowed to a blank pane** — `catch { return '' }` shows nothing with no
  feedback when `transform` throws.
- 🟡 **Pipeline divergence** — preview goes through markdown-it/`transform` while the editor
  renders via ProseMirror; for plain Markdown they match closely, but they are different renderers
  and can drift on edge cases. Minor today.

---

## 🟠 6. Dependencies: several direct deps are never imported

**Confidence: high that they're unimported; medium on whether each is safely removable.**
A grep of `src/` for every non-obvious dependency finds only **one** in use:

```
src/components/NotePreview.tsx:  import transform from '@diplodoc/transform';
```

Not imported anywhere in `src/`: `@gravity-ui/components`, `@diplodoc/cut-extension`,
`@diplodoc/file-extension`, `@diplodoc/tabs-extension`, `markdown-it`, `highlight.js`, `katex`,
`lowlight`. Some are plausibly **peer deps** of `@gravity-ui/markdown-editor` (katex → math,
highlight.js/lowlight → code highlighting) that you must keep installed; `markdown-it` is a
transform dependency. But `@gravity-ui/components` and the three `@diplodoc/*-extension` packages
look genuinely unused — the editor is configured without those extensions
([EditorPane.tsx:45-58](src/components/EditorPane.tsx#L45-L58)). **Action:** run `npx depcheck`,
move true peer deps to where they belong, and drop the dead ones to cut install + bundle weight.
(Overlaps a Cursor note; confirmed here with the actual grep.)

---

## 🟡 7. Accessibility, input, and responsiveness

- **No `prefers-reduced-motion`** — the saving-status dot blinks on a 1.4 s loop
  ([TopBar.css:31-54](src/components/TopBar.css#L31-L54)) and the sidebar slides
  ([Workspace.css:74-89](src/components/Workspace.css#L74-L89)) with no reduced-motion fallback.
- **Esc ladder breaks when the sidebar is collapsed** — collapsed rows are `visibility: hidden`
  ([Workspace.css:66-78](src/components/Workspace.css#L66-L78)), so `escapeEditor` →
  `focusSelected()` targets an unfocusable row and focus falls to `<body>`; the next Esc tries the
  same hidden row. This is the README's known *"ESC key behaviour improvement with closed
  sidebar"* — confirmed mechanism: when collapsed, route Esc to peek-the-sidebar or to the search
  box instead.
- **Peek dismiss is mouse-only** — the outside-click closer listens on `mousedown`
  ([Workspace.tsx:96](src/components/Workspace.tsx#L96)); use `pointerdown` for touch/pen parity.
- **Row actions appear on hover only** — pin/rename/delete live in a hover-revealed menu, hard to
  reach on touch (mobile is out of scope today, but `MobileProvider` is mounted).
- 🟡 `main.tsx` asserts `#root` non-null ([main.tsx:23](src/main.tsx#L23)); a missing root throws a
  cryptic error rather than a friendly message.

---

## 🟡 8. Build / CI / types

- **`vite.config.ts` is not type-checked** — `tsconfig.json` `include` is `["src"]`, so the build
  config (and its `esbuild`/`test` settings) is invisible to `tsc`. A split
  `tsconfig.node.json` covering root configs would catch regressions.
- **`build:single` isn't in CI** — the `esbuild: {charset: 'ascii'}` ASCII-safety workaround
  ([vite.config.ts:12](vite.config.ts#L12)) exists precisely because the single-file build broke
  once; nothing in [ci.yml](.github/workflows/ci.yml) exercises it, so a regression ships silently.
  Add `npm run build:single` (and ideally a smoke-load of the output) to CI.
- **No coverage tooling** — no `test:coverage` script or threshold; fine for now, but the gaps
  below are invisible without it.

---

## 🟡 9. Test-coverage gaps

The suite is strong where it exists, but whole modules have **zero** tests — and they're the
first-run, hardest-to-debug paths:

- `src/storage/handlePersistence.ts` — IndexedDB save/load/clear + permission flow.
- `src/hooks/useNotesFolder.ts` — the entire folder/permission state machine.
- `src/components/FolderGate.tsx`, `src/components/NotePreview.tsx`, `src/App.tsx`.

Behavior-level gaps worth a targeted test (with `vi.useFakeTimers`): the 500 ms debounce timing;
`flush()` hitting `ConflictError`/`NotFoundError`; the refocus `stat()` external-change detector;
the revert-to-original case from §2a; and a same-note `open()` *not* bumping `sessionId` once §3
is fixed.

---

## Corrections to `CURSOR_REVIEW.md`

Calibrating two claims so they don't drive wasted effort:

1. **"`grantPermission` doesn't set `folderName` → 'Grant access to ′′'"** — effectively a
   non-issue. `grantPermission` is only reachable from the `needs-permission` screen, and the
   mount effect sets `folderName` *before* entering that state
   ([useNotesFolder.ts:51-57](src/hooks/useNotesFolder.ts#L51-L57)). The empty-name case can't
   occur through the UI.
2. **"`NotePreview` XSS via `dangerouslySetInnerHTML`"** — not implied by the Cursor text, but to
   pre-empt it: verified safe (see §5). The risk is divergence/blank-on-error, not injection.

Everything else in the Cursor review that overlaps mine, I independently **confirmed**
(flush-before-delete, folder-change flush, flush-failure overwrite, open() remount/races,
non-atomic rename + metadata, case-only rename, IDB close leak, a11y/reduced-motion, coverage
gaps, deps).

---

## Suggested order (max safety per diff)

1. **Fix `⌘⇧;`** (§1) and its masking test — small, currently-broken user-facing feature.
2. **Short-circuit same-note `open()`** (§3) — kills click/`⌘J`-at-end remounts and shrinks the
   navigation race in one change.
3. **Flush before `remove` and `forgetFolder`; fix flush-failure restore and revert-to-original**
   (§2) — the data-loss cluster.
4. **Atomic `writeMetadata` (temp + replace)** (§4) — protects pins/sort/active from a torn write.
5. **`db.close()` on error; case-fold rename check** (§4).
6. **Tests for `useNotesFolder` + `handlePersistence`** (§9) — the untested first-run surface.
7. **`depcheck` + trim deps; add `build:single` to CI; type-check root configs** (§6, §8).

---

*Generated by Claude (Opus 4.8). Dependency defaults and shortcut behavior were verified against
the installed packages and source, not assumed.*
