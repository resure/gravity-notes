# Gravity Notes — Code Review (GLM)

An independent, from-scratch review of the codebase. Every "bug" claim below was checked against the
current source (commit `ab4df84`) rather than assumed; line numbers are accurate as of that commit.
Where a finding is theoretical or environment-dependent I say so explicitly.

There is already a `CURSOR_REVIEW.md` in the tree. This document is intentionally independent — it
overlaps on several real issues (I confirmed those rather than copy them) and adds findings that one
misses.

## TL;DR

The codebase is genuinely well-engineered for a v0.1: a clean storage seam, a careful editing model
that avoids remounting the editor mid-keystroke, tolerant metadata parsing, and good unit-test
coverage of the trickiest pure logic. The problems concentrate in three places:

1. **The unload / data-safety net is weaker than it looks.** The `beforeunload` unsaved-changes prompt
   is effectively dead for normal pending edits (verified — see §1.1), and async saves cannot reliably
   finish during unload by browser design.
2. **A handful of correctness bugs in the autosave/navigation lifecycle**, including a stale-save on
   undo-within-the-debounce-window (§1.2) and an unsynchronized `open()` race (§1.3).
3. **Surface-level gaps**: a preview render path whose HTML policy diverges from the editor (§3.1),
   untested folder-persistence code, drifted docs, and likely-unused direct dependencies.

Recommended starting point: §1.1 and §1.2 are small, high-value fixes.

---

## What's working well

- **Storage abstraction (`src/storage/types.ts`).** `NoteStore` carries no FS-specific types, so the
  Electron/HTTP/IndexedDB backends described in `CLAUDE.md` really would be drop-in. The error model
  (`ConflictError`, `NameCollisionError`) is clean.
- **Editing model (`src/hooks/useNotes.ts`).** Decoupling keystrokes from React state (`pendingRef` +
  500 ms timer instead of `setState` per keystroke) is exactly right for a ProseMirror-based editor.
  `sessionId` to separate "rename in place" from "real note switch" is a nice touch.
- **Metadata layer (`src/storage/metadata.ts`).** Pure functions (`orderNotes`, `reconcile`,
  `withRenamed`, …) that are trivial to test, plus a tolerant `parseMetadata` that never throws. Good.
- **Navigation (`useNoteNavigation.ts`, `NoteList.tsx`).** nvALT-style search-or-create, roving
  tabindex, the editor→list→search Esc ladder, sidebar peek — coherent and well-commented.
- **Canonical body shape.** `stripTrailingNewlines` on read + single blank line on write prevents the
  "editor re-saves on every open" footgun. The comment explaining why is exactly the kind of comment
  that should exist.

---

## 1. Bugs — data safety & correctness

### 1.1 The `beforeunload` unsaved-changes prompt never fires for pending edits *(verified)*

`useNotes` registers a `beforeunload` handler that tries to flush, then prompts if there's pending
or conflicted work:

```ts
// src/hooks/useNotes.ts:407-416
const onBeforeUnload = (event: BeforeUnloadEvent) => {
    void flush();
    if (pendingRef.current || conflict) {
        event.preventDefault();
        event.returnValue = '';
    }
};
```

The problem is the ordering. `flush()` is `async`, but an async function runs **synchronously until
its first `await`**. The first thing `flush()` does after arming is null out the pending edit:

```ts
// src/hooks/useNotes.ts:146-152
const flush = useCallback(async () => {
    clearTimer();
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;          // ← runs synchronously, before the first await
    try {
        const meta = await store.save(pending.id, pending.content, baselineRef.current ?? 0);
```

So by the time `void flush()` returns control to the next line of `onBeforeUnload`,
`pendingRef.current` is already `null`. The guard then reduces to `null || conflict` — i.e. **a
normal pending edit (no conflict) does not trigger the prompt.** The "warn before unload if edits are
unsaved" behavior described in the comment is dead for the common case.

**Fix** — capture intent before flushing:

```ts
const hasUnsaved = Boolean(pendingRef.current || conflict);
void flush();
if (hasUnsaved) {
    event.preventDefault();
    event.returnValue = '';
}
```

### 1.2 Undo-back-to-original within the debounce window saves stale content *(verified)*

`EditorPane` suppresses the initial-load change event by comparing the editor value to the loaded
note content:

```ts
// src/components/EditorPane.tsx:77-85
const handleChange = () => {
    const value = editor.getValue();
    if (value !== note.content) {
        onChange(value);
    }
};
```

`note.content` is the **originally loaded** body; it is never updated as the user edits (editing is
deliberately decoupled from React state). That's fine for *firing* `edit()`, but it means the
comparison also suppresses a change whose value happens to equal the original — e.g. **type a
character, then ⌘Z within 500 ms.** Sequence:

1. Type `x` → value `"hellox"` ≠ `"hello"` → `edit("hellox")`, `pendingRef = "hellox"`, timer armed.
2. ⌘Z → value back to `"hello"` == `"hello"` → `handleChange` **skips**, `pendingRef` stays `"hellox"`.
3. Timer fires → `flush()` writes `"hellox"` to disk.

The editor now shows `"hello"` but the file contains `"hellox"`, and the divergence is invisible
until the note is reopened. Any round-trip back to exactly the loaded content (undo, or re-typing the
same text) within the debounce window has this effect.

**Fix** — let `edit()` always record the latest value and clear the "dirty" suppression differently,
e.g. track a `dirtyRef` set on first real change and only suppress the *very first* change after a
load, or compare against the value the editor had at mount rather than gating each event.

### 1.3 `open()` is unsynchronized — a slow earlier load can clobber a later one *(verified)*

There is no generation token around `open()`. `browse()` (clicks and ⌘J/⌘K) always calls `open()`
even for the already-active note, and each `open()` does `store.get()` + `persistMetadata(withActive)`
as separate awaits:

```ts
// src/hooks/useNotes.ts:171-191
const open = useCallback(async (id: string) => {
    await flush();
    const loaded = await store.get(id);     // slow disk read
    ...
    await persistMetadata(withActive(metadataRef.current, id));  // writes active=id
}, ...);
```

Two rapid browses (A then B) can resolve out of order: if `get(A)` finishes after `get(B)`, the editor
ends on A while `active` was just written as B — and then A's trailing `persistMetadata` overwrites
`active` back to A. The last-to-*resolve* call wins, not the last-fired. On a slow disk / busy main
thread this surfaces as "I clicked B but it opened A."

**Fix:** (a) short-circuit `open()` when `id === activeId` (this also kills the editor remount on
re-clicking the open note — see §2.1), and (b) add an open-generation counter; ignore the result of a
load whose generation is stale.

### 1.4 Changing the folder drops unsaved edits *(verified)*

`App.tsx` wires "change folder" straight to `forgetFolder()`:

```tsx
// src/App.tsx:43
onChangeFolder={() => void folder.forgetFolder()}
```

`Workspace` then unmounts, and `useNotes`' unmount effect only clears the timer — it does **not**
flush:

```ts
// src/hooks/useNotes.ts:399-404
useEffect(() => {
    return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    };
}, []);
```

`open`/`create`/`rename`/`close` all flush first; folder-change is the one lifecycle path that
doesn't, so any edit still in the 500 ms window (or paused on a conflict) is silently lost. Combined
with §1.1, the unload path won't catch it either.

**Fix:** flush (and confirm if `saveState !== 'idle'` or a conflict is open) before calling
`forgetFolder()`.

### 1.5 `visibilitychange`/`beforeunload` flush is best-effort by browser design

`onHide` and `onBeforeUnload` both do `void flush()`. `store.save()` → `createWritable()`/`close()` is
asynchronous I/O; browsers do not guarantee it completes before a tab is torn down (it generally does
on `visibilitychange` — tab switch — and generally *doesn't* on `beforeunload` — close). So even with
§1.1 fixed, closing the tab with pending edits is not reliable. This is a platform limitation, not a
bug, but it's worth being honest about in the UI (the status dot can imply "saved" when it isn't on
disk yet). A `navigator.locks`/sendBeacon-style guarantee isn't available for FS Access writes, so the
realistic mitigation is the 500 ms debounce itself plus the §1.1 prompt.

### 1.6 `remove()` skips flush (low severity)

`remove()` is the only mutating lifecycle op that doesn't flush first (`src/hooks/useNotes.ts:263-282`,
`store.remove` at `:266`). In practice the only edit it can drop is on the note being deleted, so the
user impact is low — but for consistency with `open`/`create`/`rename`/`close`, a `flush()` (or at
least clearing `pendingRef` for the deleted id, which it already does) keeps the contract uniform.

---

## 2. Bugs — UX / interaction

### 2.1 Re-clicking (or re-browsing) the open note remounts the editor *(verified)*

`NoteList`'s row click goes through `browseRow → onBrowse → nav.browse → open`, and neither `browse`
nor `open` checks `id === activeId` (`src/hooks/useNotes.ts:171`, `src/hooks/useNoteNavigation.ts:64`).
So clicking the already-open note bumps `sessionId` and remounts `EditorPane` (keyed by `sessionId` in
`Workspace.tsx:330`), losing caret position, scroll, undo history, and focus. `commit()` already has
this guard (`useNoteNavigation.ts:76`); `browse`/`open` need the same. Same fix as §1.3(a).

### 2.2 External-change detection is focus-only

The conflict detector (`src/hooks/useNotes.ts:425-447`) only re-stats the open note on `focus`/
`visibilitychange`. If the app stays focused and the file is edited externally (another tool, a sync
client), the conflict isn't noticed until the user leaves and returns. Not wrong, but worth either a
low-frequency `setInterval` poll or `FileSystemObserver` where available. Also noted in CURSOR_REVIEW.

### 2.3 Non-blocking conflict banner lets the user keep typing

While a conflict is open, autosave is paused (good), but the editor remains fully editable and there's
no modal block, so a user can accrue a large amount of unsinkable typing before noticing the banner.
Consider dimming/disabling the editor or making the banner more assertive until resolved.

### 2.4 Smaller interaction issues

- **`NoteTitle` whitespace-only commit.** Blur commits whatever's in the draft; a whitespace-only title
  sanitizes down to `Untitled` (`fileSystemStore.ts:51-59`), which can then collide via
  `uniqueFileName`. The list-rename path trims (`NoteList.tsx:149-155`); the in-editor title path does
  not. Align them.
- **Case-only rename fails on case-insensitive filesystems** (macOS/Windows default). `rename`'s
  `exists(nextName)` check (`fileSystemStore.ts:169`) sees the source file itself as a collision for
  `note.md` → `Note.md`. Needs a same-file/case-fold-aware check.
- **Selected note filtered out by search.** When the query hides the selected row, there's no visible
  `aria-selected` row and `focusSelected` may focus the wrong element. Minor, but disorienting.
- **F2 while editing the in-editor title** renames the *list* selection, not the title being edited
  (`useShortcuts` → `listRef.startRename`). Surprising.
- **Peek dismiss is `mousedown`-only** (`Workspace.tsx:85-98`); touch events won't dismiss the peeked
  sidebar.

---

## 3. Security

### 3.1 Preview renders with a different (HTML-allowing) policy than the editor *(verify before shipping)*

The editor disables raw HTML:

```ts
// src/components/EditorPane.tsx:47
md: {html: false},
```

…but the read-only preview renders through `@diplodoc/transform` with **default options** and no
`html: false`:

```ts
// src/components/NotePreview.tsx:22-28
const html = useMemo(() => {
    try {
        return transform(markup).result.html;   // no {html: false}
    } catch {
        return '';
    }
}, [markup]);
```

…and that HTML is injected via `dangerouslySetInnerHTML` (`NotePreview.tsx:33`). The adjacent comment
("the editor disallows raw HTML") describes the editor, not this preview path. `@diplodoc/transform`
is built for YFM, which passes HTML through by default, so a note containing
`<img src=x onerror=…>` (typed in Markup mode, or present in an imported/synced file) could execute in
preview. For purely-local user-authored notes this is self-inflicted, but the moment notes come from
anywhere else (future sync/import) it's an XSS sink, and either way it's a policy inconsistency
between two renderers of the same document.

**Action:** confirm diplodoc's default HTML behavior for the pinned version; pass the same
`{html: false}` (or an explicit sanitizer) to the preview transform so preview can never render
content the editor forbids.

### 3.2 General posture

- Scope is a user-granted directory — good. FS Access API sandbox limits traversal.
- Metadata file (`.gravity-notes.json`) is unsigned and user-editable; `parseMetadata` is tolerant, so
  the worst case is confused UX, not code execution.
- IndexedDB handle persistence is origin-scoped — standard XSS hygiene applies (and §3.1 is the most
  plausible in-app XSS vector).
- No `id` validation before `getFileHandle` — the browser rejects bad paths, but the store doesn't
  fail fast on obviously malformed ids. Low risk given all ids currently originate internally.

---

## 4. Concurrency / multi-tab (known limitations)

These are product-level, worth documenting rather than necessarily fixing now:

- **Last-write-wins on `.gravity-notes.json`.** Pins, sort, `active`, and `created` stamps have no
  merge semantics across tabs.
- **mtime-only conflict detection.** Coarse filesystem mtime resolution can both miss and false-trigger
  conflicts.
- **Parallel `create('Untitled')` in two tabs** can race `uniqueFileName` (`fileSystemStore.ts:193`),
  which also has no upper bound (theoretical infinite loop if every candidate exists — give it a cap).
- **Non-atomic rename** (`fileSystemStore.ts:161-186`): copy→write→delete with no rollback. A failure
  mid-sequence can duplicate the note (create succeeded, delete didn't) or, worse, lose it. And
  `save()` is a check-then-write TOCTOU on mtime (`fileSystemStore.ts:110-122`) — acceptable for a
  single-tab local app, but not under contention.
- **Non-atomic metadata write** (`fileSystemStore.ts:154-159`): no temp-file-then-replace; a crash
  mid-write yields corrupt JSON, which `parseMetadata` silently resets to defaults (losing all
  pins/sort/created). A temp+replace pattern would make this crash-safe.

---

## 5. Tests

Good coverage of pure logic (`metadata.test.ts`, `fileSystemStore.test.ts`, navigation in
`Workspace.test.tsx`). Gaps that matter:

**Untested modules (zero coverage):**
- `src/storage/handlePersistence.ts` — IndexedDB save/load/clear and permission helpers. This is the
  first-run path and it's untested. Also has a real leak: `tx()` only calls `db.close()` on
  `transaction.oncomplete` (`handlePersistence.ts:35`), not on `request.onerror` — a failed request
  leaves the DB connection open.
- `src/hooks/useNotesFolder.ts` — the entire `loading → needs-folder → needs-permission → ready` state
  machine, including the mount/pick race noted in CURSOR_REVIEW and the lack of a `catch` on
  `loadDirHandle()`.
- `src/components/FolderGate.tsx`, `NotePreview.tsx`, `App.tsx`.

**Gaps in tested modules:**
- The 500 ms debounced autosave itself (fake timers) and `flush()` raising `ConflictError`/
  `NotFoundError`.
- §1.1 (beforeunload prompt), §1.2 (undo-stale-save), §1.3 (open race) — none are exercised.
- External-delete detection via the refocus `stat()` check.
- Conflict flow end-to-end (reload / keepMine / saveAsCopy / discard) through `Workspace`.

**Infra:** no coverage tooling — no `test:coverage` script or threshold, so these gaps are invisible
in CI.

---

## 6. Infrastructure & dependencies

- **Likely-unused direct dependencies** *(verified by grep over `src/`)*: `@gravity-ui/components`,
  `markdown-it`, `highlight.js`, `katex`, `lowlight`, `@diplodoc/cut-extension`,
  `@diplodoc/file-extension`, `@diplodoc/tabs-extension`. None are imported in `src`. Some may be
  required as peers for `@gravity-ui/markdown-editor` features (the cut/tabs/file extensions are YFM
  features the editor may auto-register); **verify before removing.** If not needed, they bloat the
  install/lockfile for no reason. `@diplodoc/transform` *is* used (`NotePreview.tsx:3`).
- **`build:single` is not in CI** (`.github/workflows/ci.yml` runs only `build`). The single-file
  build has its own ASCII-charset escape logic (`vite.config.ts:9-12`, added to fix a real load crash
  per commit `51b09e4`); regressions there won't be caught. Add `npm run build:single` to CI.
- **`vite.config.ts` is not typechecked.** `tsconfig.json` `include` is `["src"]` (`tsconfig.json:16`),
  so `tsc` never sees the Vite config. A split `tsconfig.build.json` (or adding the config to a
  separate typecheck step) would cover it.
- **No React error boundary** around `Workspace`/`App`. Storage errors reach the toaster, but a render
  throw blanks the whole app.
- **`main.tsx:23`** uses a non-null assertion on `getElementById('root')` — fine in practice, but a
  guard is cheap.

---

## 7. Documentation drift

`README.md` describes the app at an earlier stage. It mentions nvALT navigation but **not**: pinning,
the four sort modes, the conflict-resolution flow, the shortcuts dialog (`⌘/`), preview mode
(`⌘⇧P`), sidebar peek (`⌘'`), or the `.gravity-notes.json` metadata sidecar. `CLAUDE.md`'s
architecture sketch omits `TopBar`, `useNoteNavigation`, `useNoteSearch`, `useShortcuts`, and the
conflict/metadata machinery. These are the docs a new contributor (or an agent) reads first.

---

## Recommended fix order

Smallest diffs first, weighted toward not losing the user's writing:

1. **§1.1 — fix the beforeunload prompt ordering** (a few lines; restores a safety net that currently
   doesn't exist).
2. **§1.4 — flush before folder change** (small; prevents silent edit loss on a primary action).
3. **§1.2 — undo-stale-save** (small; a real silent data-correctness bug).
4. **§2.1 / §1.3(a) — short-circuit `open()` for the active note** (small; fixes remount-on-reclick
   and removes race surface).
5. **§1.3(b) — open-generation guard** (medium; kills the wrong-note race).
6. **§3.1 — align preview HTML policy with the editor** (small once the diplodoc default is confirmed;
   closes the main XSS vector).
7. **§5 — tests for `handlePersistence` + `useNotesFolder`, and the autosave/conflict paths; fix the
   `db.close()` leak and add a `catch` on `loadDirHandle`.**
8. **§4 — atomic metadata write (temp+replace); rename rollback/case-fold.**
9. **§6/§7 — CI (`build:single`), typecheck the Vite config, prune deps after verifying peers, refresh
   README/CLAUDE.md.**

---

*Independent review generated by GLM — June 2026. Findings verified against source at commit `ab4df84`.*
