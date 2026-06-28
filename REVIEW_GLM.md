# Gravity Notes — Code Audit (REVIEW_GLM.md)

Audit of the full codebase (TS front-end + Rust Tauri shell) for bugs, data-loss risks,
backend inconsistencies, and improvements. Every finding below was **verified by reading the
actual code** (file:line cited); speculative items are separated out. Findings reported by the
initial broad-brush sweep that turned out to be false positives are listed in
[§ Dismissed / verified-safe](#dismissed--verified-safe) so they don't get chased.

**Health check at audit time:** `npm test` → **662/662 pass**; `npm run typecheck` → clean;
`npm run lint` → **0 errors, 27 warnings** (all minor: `no-nested-ternary`, `no-non-null-assertion`
in tests, one `no-shadow`, one `no-param-reassign`). The pure core (`search`, `tree`, `metadata`,
`noteText`) and all three stores are densely unit-tested. The issues below are mostly in the
harder-to-test seams: async autosave timing, byte-vs-text I/O, and the React/ProseMirror lifecycle.

---

## High

### H1. FS backend copy-based ops decode-and-re-encode every file as UTF-8 text → corrupts non-text (and non-UTF-8) files
`src/storage/fileSystemStore.ts:518` (`copyTree`), and the same pattern in `move` (`:199`/`:233`),
`trash` (`:262`), `restore` (`:294`).

`copyTree` reads each file with `getFile().text()` and writes the resulting string back. A UTF-8
text round-trip is **lossy for any non-UTF-8 bytes** — every byte that isn't valid UTF-8 becomes a
`U+FFFD` replacement char. The single-note `move`/`trash`/`restore` ops do the same: `get()` returns
`await file.text()` and `writeFile()` writes the string.

- **Impact:** Moving a folder (web/FSA backend) that contains a non-`.md` file — a PDF, an image
  placed beside notes by someone migrating from Obsidian/Notable, or any binary — **silently
  corrupts** it. Even a `.md` note carrying non-UTF-8 bytes (an externally-edited latin-1 file, a
  pasted binary blob) is mangled on move/trash/restore. This directly undermines the app's headline
  "a folder of plain files that interoperates with external tools" promise.
- **Why it's a bug:** `const text = await (handle.getFile()).text(); … writeFile(out, text);` —
  `text()` decodes as UTF-8; there is no byte path.
- **Backend scope:** **Web/FSA only.** `TauriNoteStore` uses real atomic `fs::rename`
  (`lib.rs:484`, byte-perfect); `IndexedDbNoteStore` stores note `content` as a string already and
  rekeys in place. So the same folder-move is safe on desktop but corrupts on web — a silent
  cross-backend divergence.
- **Fix:** Copy bytes, not text — read via `getFile().arrayBuffer()` and write the `Uint8Array`/`Blob`
  (the `writeFile(handle, data: string | Blob)` helper already accepts a `Blob`). For `move`/`trash`/
  `restore`, carry the raw bytes through instead of round-tripping `content`. Add a test that moves a
  folder containing a binary file and asserts byte-equality.

---

## Medium

### M1. `rename()` silently drops the pending edit when its preceding `flush()` fails
`src/hooks/useNotes.ts:460–466`.

`rename` does `await flush()` then, after `store.rename`, `if (pendingRef.current?.id === id)
pendingRef.current = null;` (`:466`). `flush()` **restores** `pendingRef` on failure (`:263`, so a
conflict/error doesn't lose the edit) — but `:466` then unconditionally nulls it, and `store.rename`
has already written **disk content** (its internal `get()`), not the user's typed bytes. Net effect:
if the rename's flush raises a conflict or save error, the user's unsaved keystrokes are discarded
and the file is renamed to its on-disk content. Compare `move()` (`:535–541`) and `moveFolder`'s
`repointOpenNote` (`:413–429`), which carefully carry the pending edit to the new id.

- **Fix:** Carry the pending edit across the rename like `move()` does, or only null `pendingRef`
  when `flush()` actually succeeded (it was already null). Narrow trigger, but it's data loss.

### M2. `flush()` has no timeout — a hung backend write blocks every note operation and tab close
`src/hooks/useNotes.ts:250–275`.

Every lifecycle transition (`open`/`create`/`rename`/`move`/`remove`/`trash`/`close`/`moveFolder`)
`await flush()`, and `beforeunload` calls `void flush()` (`:872`). `flush()` awaits `store.save()`
with no timeout/abort. If a backend write stalls (an FSA permission prompt stuck, a wedged Tauri
IPC call), **all** note ops hang indefinitely, and a stall inside the `beforeunload` flush can prevent
the tab from closing.

- **Fix:** Race `store.save(...)` against a timeout (e.g. `Promise.race` with ~10s, or an
  `AbortController`) and surface a clear error instead of hanging.

### M3. A failed autosave is never retried — the edit sits stranded until the next keystroke
`src/hooks/useNotes.ts:260–274`.

On a save failure, `flush()` restores `pendingRef` (`:263`) and calls `setSaveState('error')` +
toasts, but **does not re-arm `timerRef`**. If the user stops typing, the pending edit is parked in
memory with no retry; it only flushes again on the next lifecycle transition or keystroke. A user who
misses the transient error toast assumes their edit was saved.

- **Fix:** Re-arm the timer (with backoff) in the catch block so a transient failure retries.

### M4. Note-switch typing window can leave a stale `pendingRef` and raise a spurious conflict on the outgoing note
`src/hooks/useNotes.ts:286–298`.

In `open()`, after `await flush()` and during `await store.get(id)`, the editor still shows the old
note and `metadataRef.current.active` is still the old id. A keystroke in that window calls `edit()`,
which tags `pendingRef = {oldId, content}`. `open()` never clears a stale `pendingRef` after load, so
that edit lingers; when it later flushes, it saves `{oldId, content}` against `baselineRef` — which
by then holds the **new** note's mtime → a spurious `ConflictError` on the note the user just left.

- **Impact:** Annoying, not data-losing (the conflict surfaces; content is the old note's own edit).
  Requires typing precisely during a note switch.
- **Fix:** After a successful `open()`, drop any `pendingRef` whose id isn't the newly active note.

---

## Low

### L1. `AttachmentUrlCache.dispose()` can leak a blob URL when a read is in flight
`src/attachments.ts:34–48` + `:70–74`.

`resolve()` stores the `readAttachment` promise in `pending`; its `.then` runs
`URL.createObjectURL(blob)` and `urls.set(ref, url)`. `dispose()` clears both maps and revokes known
URLs, but **can't cancel** the in-flight `readAttachment` promise — when it later resolves, the `.then`
creates a fresh object URL on a disposed cache that is never revoked. Triggers on store-change while
an image is still loading.

- **Fix:** Add a `disposed` flag; check it in the `.then` (skip `createObjectURL`/`set` if set).

### L2. `beforeunload` / focus conflict-check listeners re-subscribe on every `conflict` change
`src/hooks/useNotes.ts:865–885` and `:888–916`.

Both effects list `conflict` in their dep arrays, so each conflict set/clear tears down and re-adds
the `visibilitychange`/`focus`/`beforeunload` listeners. Functionally correct (cleanup runs first),
but unnecessary churn. Read `conflict` through a ref and drop it from the deps so each effect runs once.

### L3. `NotePreview` parses a full detached DOM tree on every render
`src/components/NotePreview.tsx:22–23`, `:50–52` (`withResolvedImages`, `withWikiLinks`).

Each builds a `new DOMParser().parseFromString(...)` and re-serializes via `innerHTML`, inside an
effect that re-runs on each `markup`/attachment-resolution change. GC'd, so not a leak, but transient
allocation churn on large notes. A regex/`replace` pass (attachment srcs are URL-safe per
`uniqueAttachmentName`) would be cheaper.

### L4. Folder tree exposes no depth to assistive tech
`src/components/FolderRail.tsx:357`, `:475`, `:599`.

Container is `role="tree"` and rows are `role="treeitem"`, but no row sets `aria-level` and children
aren't wrapped in `role="group"`. Screen readers announce the hierarchy as a flat list. Add
`aria-level={depth + 1}` and group expanded children.

### L5. Index-based React keys on search-highlight fragments
`src/components/NoteList.tsx:89` — `<mark key={i}>` from a regex split whose length shifts per
keystroke. Minor re-mount churn / IME edge while typing in the search box. Key on `${i}:${part}`.

### L6. Error/info toast names use `Date.now()` — collisions drop a toast
`src/components/Workspace.tsx:79`, `:310` — `name: \`notes-error-${Date.now()}\``. Two toasts in the
same millisecond (e.g. a partially-failing import) collide on the Gravity toaster's name key.
Append a monotonic counter.

### L7. Side effect inside a state updater
`src/components/BacklinksPanel.tsx:32–34` — `localStorage.setItem` runs inside the `setCollapsed`
updater. Double-fires under `<StrictMode>` in dev. Move persistence to a `useEffect`.

### L8. `sanitizeSegment` permits leading dots → dotfile notes appear in listings
`src/storage/noteText.ts:133–141`. A title like `.hidden` becomes `.hidden.md`; the walks skip
dot-**directories** but not dot-**files**, so it shows up. Minor inconsistency with the dotfile-as-
system convention. Strip leading dots, or add `.` awareness.

### L9. Resize-drag window listeners leak if the image NodeView is destroyed mid-drag
`src/components/editor/attachmentImageView.tsx:117–118`. `pointermove`/`pointerup` are added to
`window` in `onResizeDown` and removed only in `onUp`; deleting the image (e.g. via keyboard) while
dragging leaves them dangling with a stale `dragRef`. Low probability. Track the handlers and remove
them on unmount.

### L10. `uniqueName` / `uniqueAttachmentName` bound is 100 000 iterations of awaited I/O
`src/storage/noteText.ts:171`, `:206`. A pathological collision storm would do up to 100k sequential
async probes. Effectively unreachable in practice; lower the bound or batch.

---

## Hardening / verify

- **Verify `@diplodoc/transform` sanitization in the preview** — `NotePreview.tsx:108,142` renders
  `transform(markup)` into `dangerouslySetInnerHTML`, relying on diplodoc's default raw-HTML escaping.
  For the user's own notes this is self-inflicted; the real vector is **import** (`transfer.ts`). Worth
  confirming diplodoc strips `javascript:` link schemes (the desktop `open_external` already restricts
  schemes to http/https/mailto/tel — `lib.rs:581`).
- **`resolve_within` is lexical; a symlinked *picked* root isn't canonicalized** — `lib.rs:74–93`.
  The `..`/absolute defenses are solid (tested by `rejects_path_traversal_on_every_argument`), and the
  user explicitly picks the folder, so this is low-risk. If hardening is desired, canonicalize `dir`
  once at pickup.
- **IndexedDB connection is held for the tab's lifetime** — `indexedDbStore.ts:424–450` (no `close()`).
  This is a defensible performance choice and matches a single-version app; the only downside is that a
  future `DB_VERSION` bump from another tab/window would be `blocked` until this tab closes. Note it
  when planning a v4 migration.
- **`restore()` mtime differs across backends** — `fileSystemStore.ts:303–309` documents that the FSA
  copy bumps mtime to "now" while Tauri/IndexedDB preserve the original. Already acknowledged in
  comments; surfaces as a cross-backend sort-position difference. Consider stamping the FS restore with
  the preserved mtime (via an extra `utimes`-style op) if parity matters.

---

## Inconsistencies across the three backends

The `NoteStore` seam is largely faithful, but a few behaviors diverge:

| Operation | FileSystem (web FSA) | Tauri (Rust) | IndexedDB |
|---|---|---|---|
| **Folder move** | copy-then-delete, **text round-trip (H1)** | atomic `fs::rename`, bytes preserved | re-key records, content string |
| **Note move/trash/restore** | copy-then-delete, **text round-trip (H1)** | atomic rename, bytes preserved | re-key, mtime preserved |
| **Restore mtime** | "now" | preserved | preserved |
| **Rename atomicity** | write-then-delete (non-atomic) | atomic rename | single-tx put+delete (atomic) |
| **Connection lifecycle** | n/a (handle) | n/a (per-invoke) | held forever (L-hardening) |

The pure helpers (`noteText`, `metadata`, `search`, `tree`) and the conflict contract
(`ConflictError`/`NotFoundError`, `canonicalBody`, `baseUpdatedAt`) are consistent across all three —
the drift is concentrated in the file-copy path that only the FSA backend needs.

---

## Dismissed / verified-safe

These looked bad in the broad sweep but are **not** bugs after reading the code — listed so they
aren't re-investigated:

- **"Zip-slip via `writeAttachmentAt`" (was flagged Critical).** Not exploitable on any backend.
  The FSA `getDirectoryHandle('..')` throws `TypeError` (the API rejects `.`/`..`/separators as names),
  so `resolveDir` (`fileSystemStore.ts:529`) can't walk above root; the Rust `attachment_write` runs
  `resolve_within` which rejects `..` (`lib.rs:355`, tested); IndexedDB keys aren't a filesystem. The
  only real residue: a malformed zip with `../` in an attachment path throws an opaque error on import
  rather than a friendly message.
- **"Wiki-link `escape: false` corrupts `_`/`~`/backtick titles" (was flagged Medium).** False. The
  parser rule registers `md.inline.ruler.before('link', …)` (`wikiLinkExtension.ts:182`) and consumes
  the entire `[[…]]` span into one text token **before** markdown-it's emphasis rule ever sees those
  characters, so `[[to_do]]` round-trips intact. `escape: false` is correct and required. (Niche real
  edge: a note *title* containing `]` can't be linked, since the parser rejects a lone `]` — `:192`.)
- **"Generation counter doesn't guard `flush` / wrong-note save" and "edit() tags the wrong baseline
  during rename/move" (were flagged Critical).** Overstated. The winning `open()` re-seeds
  `baselineRef` (`useNotes.ts:293`), and the `persistMetadata`→`baselineRef` ordering in `move`/
  `moveFolder` is covered by the 500 ms debounce — the actual worst case is the spurious-conflict
  window in **M4**, not silent corruption.
- **"IndexedDB `moveFolder` self-clobber / collision miss".** Correct as written: the rekey math
  (`to + id.slice(from.length)`) and the single-transaction put+delete (`indexedDbStore.ts:370–380`)
  are right, and note ids always end in `.md` so they can't collide with a folder path.

---

## Positive observations

- **Conflict/autosave design is genuinely careful** — editing decoupled from React state via ref+timer,
  generation-guarded `open()`, `flush()` restores-on-failure only when no newer edit landed, conflict
  resolvers (`keepMine`/`saveAsCopy`/`discard`) all preserve content, and lifecycle transitions flush
  first. The remaining gaps (M1–M4) are edge windows, not structural.
- **Path containment is defense-in-depth** — `sanitizeDir` (TS) + `resolve_within` (Rust) + FSA name
  validation, with dedicated traversal tests in `lib.rs`.
- **Trash isolation is clean** — the `.trash` dot-folder gets free exclusion from every walk
  (notes/folders/search/wiki-links) on all backends; the IDB store uses a separate object store.
- **Test coverage is strong** (662 tests) across the pure core and the stores; the gaps are exactly the
  async/byte areas called out above.

---

### Suggested fix order
1. **H1** (byte-accurate copy on the FS backend) — only clear data-corruption bug.
2. **M1** (don't drop the edit on a failed rename-flush) — data loss, narrow.
3. **M2/M3** (flush timeout + autosave retry) — robustness of the save path.
4. **L1/L4** (blob-URL leak, tree a11y) — quick wins.
5. The remaining L-items and lint warnings as cleanup.
