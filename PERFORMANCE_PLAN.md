# Performance Plan — large-vault note switching

Investigation into sluggish note switching on a large vault
(`~/code/tmp/stress-notes-xl`: **3000 `.md` files, ~50 MB text, 124 MB attachments,
~25 folders**). Notes are small (max ~250 lines), so this is a **scale** problem, not a
large-note problem.

## TL;DR

The note-switch lag is dominated by one thing: the **ProseMirror editor is torn down and
rebuilt on every switch** (`key={notes.sessionId}` + mount-only `initial` markup). Everything
else on the switch path is already fast and well-memoized.

The fix has three tiers, **cheapest + lowest-risk first**:

- **B — Stop rebuilding it ~10×/s while browsing** (coalesce preview-opens). Tiny, safe,
  immediate relief for the "whole app laggy" symptom.
- **A — Don't mount the editable editor while merely browsing.** Show the existing read-only
  `NotePreview` (high-fidelity — same transformer/cache/wiki post-processing) and mount the
  editor only on commit. The structural fix; doesn't touch editor lifecycle/undo.
- **C — Reuse one editor instance across switches via `editor.replace()`.** Deepest, riskiest;
  last resort, only if A is insufficient.

**Measure first** (Step 0), then B → A, C only if needed.

## How this was checked

- Traced the switch path: `browse → useNotes.open() → EditorPane` (keyed by `sessionId`).
- Audited the Rust backend (`src-tauri/src/lib.rs`) for the IPC/FS cost of each command.
- Benchmarked every pure function at 3000-note scale (throwaway bench, since removed).
- Independent code-review (Opus 4.8) verified every claim against the tree; its corrections are
  folded in below (see _Revision log_).

Pure-function costs at 3000 notes (median):

| Op | When it runs | Cost |
|---|---|---|
| `orderNotes` / `buildFolderTree` / `notesInFolder` | memoized — **skipped on browse** | 0.2–1.0 ms |
| `listSignature` / `graphKey` | memoized on `notes` identity — skipped on browse | 0.15–0.84 ms |
| `searchNotes` (per keystroke) | only while searching | 4–10 ms |
| `buildBacklinkInversion` | per graph change, not per browse | 27 ms |
| `previewFromContent × 3000` | **once at load** | **120 ms** |
| `materializeBacklinks` (1 note) | per switch (see _Gaps_) | 0.14 ms (low-link note) |

Every per-switch JS cost is sub-millisecond and properly memoized, and the Rust single-note
read (`notes_read_opt`) is 3 syscalls (<1 ms). By elimination the only remaining per-switch
work is the one thing the bench can't measure: **the ProseMirror editor mount.**

---

## Step 0 — Measure before operating

The diagnosis is by elimination (sound, but not proof), and the fix is surgery on the core
editing surface. Get one number first on `stress-notes-xl`: a React Profiler trace (or
`performance.now()` around the mount). Measure **two** things so the A-vs-C choice is made on
data, not assumption:

1. **WYSIWYG editor mount time** (the suspected dominant cost).
2. **`NotePreview` render time** (`@diplodoc/transform` pass — the cost tier A swaps in).

If a single mount is small (~10–20 ms), B alone may suffice and A is optional. If it's large
(50 ms+), single clicks still hitch → do A. ~20 minutes; do it before writing P0 code.

---

## P0 — The editor is rebuilt on every note switch

`Workspace.tsx:855` keys the editor by `key={notes.sessionId}`; `EditorPane.tsx:99` seeds
content only via `initial: {markup: note.content}` (mount-only). Every `open()` bumps
`sessionId` (`useNotes.ts:479`), so switching notes **unmounts and remounts the entire Gravity
markdown editor** — full schema + every extension + markdown-it parser + ProseMirror view +
DOM tree + plugin graph.

Held-arrow / rapid-click browsing makes it continuous: `useNoteNavigation` fires `open()` on
the leading edge **and re-arms every 100 ms during a burst** (`BROWSE_COALESCE_MS`), so a 1 s
scroll ≈ 10 rebuilds. Even a 30–60 ms rebuild at that cadence saturates the main thread →
"whole app laggy."

### Tier B — Collapse browse coalescing to leading + trailing  *(do first; low risk)*

Today `armWindowRef` re-opens the latest note every 100 ms throughout a burst. Change it to a
**leading-edge + single-trailing** debounce: keep the cursor highlight instant on every
keypress (`setCursor`), open on the leading edge (preserves the single-press "instant-preview
feel"), then open **once** when the burst settles — no periodic mid-burst re-opens.

- A continuous held scroll drops from ~10 rebuilds/s to **~2 per scroll gesture** (leading +
  settle), regardless of burst length.
- Single press / slow scroll (>100 ms between presses): unchanged — leading edge previews
  immediately; the trailing open hits `open()`'s same-id early-return (or the existing
  `openGenerationRef` guard), so never a double rebuild.
- **No UX regression** vs the reviewer's literal "defer-all" formulation, which would have
  added up to 100 ms latency to every single arrow press.
- Clicks go through `browse` too, so click-spam benefits as well; Enter/click-to-edit
  (`commit`) bypasses coalescing (a deliberate edit), as it should.

### Tier A — Preview while browsing, editor on commit  *(structural fix; medium risk)*

While browsing, focus is in the list and the user isn't editing — yet `EditorPane` mounts the
full editable editor for every previewed note. Render the existing **`NotePreview`** from
`note.content` while unfocused/browsing, and instantiate `MarkdownEditorView` only on commit
(Enter / click-into-body). `NotePreview` is **high-fidelity**: it uses the editor's own
`@diplodoc/transform`, the same per-store `AttachmentUrlCache`, and the same `[[wiki link]]`
post-processing, so the browse view matches the editor's read-only rendering.

- Gating signal already exists: `autofocus` (`'body'|'title'|null`) — `null` while browsing,
  `'body'` on commit. Reconcile with `previewMode` (`⌘⇧P`), which always shows `NotePreview`.
- Contained UX change: clicking into a browsed note must trigger the mount + focus (today it
  focuses an already-mounted editor).
- **Does not touch** the editor's lifecycle, undo history, or change-plumbing — that's the
  point. Cost per browse is a `transform()` pass instead of a ProseMirror mount; Step 0
  confirms it's cheaper. (NotePreview itself isn't free — the YFM transform — so combine with B
  to keep browse-rate low.)
- Verify: NodeView image subscriptions turn over correctly on the commit-time mount (same
  lifecycle as today's remount, so no new hazard).

### Tier C — Reuse the editor instance via `editor.replace()`  *(last resort; high risk)*

`editor.replace(newMarkup)` re-parses into the *existing* editor. Reserve for only if a
measurement proves a live editor must be preserved across switches. If taken, it owns the two
hard parts the remount currently gives for free:

1. **Undo history — data integrity, not cosmetics (the #1 hazard).** If `replace()` doesn't
   reset ProseMirror history, ⌘Z after an A→B switch can drag the old note's text into B. A
   remount gets fresh history for free; reuse does not. The editor exposes `reset()` — likely
   the lever — but the behavior **must be verified empirically**; if it doesn't reset,
   explicitly reset (fresh `EditorState` / `reset()`). Hard gate.
2. **`settledRef` / change-handler race.** `replace()` fires `'change'` (`EditorPane.tsx:157`);
   the handler closes over `note.content` (line 164). On a fast switch the load emission can be
   mis-attributed as a user edit and written to disk. The existing first-emit suppression
   models the pattern; re-arm `settledRef` per load.

---

## P1 — `previewFromContent` runs 12 sequential regexes × every note at load (120 ms @ 3000)

Biggest *one-time* JS cost. `noteText.ts` `previewFromContent` does ~12 `String.replace(regex)`
passes per note head; `TauriNoteStore.list()` / `notes_list` call it for all 3000 at once.

### Fix (prefer the lazy variant)

Compute the preview **per visible virtualized row** (the list is already windowed via
`@tanstack/react-virtual`) instead of all 3000 at `list()`. Near-zero risk — do it first as a
free win. Fallback: collapse the 12 passes into a single regex/char-pass (120 ms → ~10 ms).

---

## P2 — Corpus load ships ~50 MB of text as JSON over IPC, sequentially (desktop, one-time ~1–2 s)

`notes_read_all` (Rust) reads all 3000 files **sequentially** (no threads/rayon in `src-tauri`),
serializes the **entire** corpus to JSON (~50–60 MB; ~150 MB peak across processes), crosses
IPC, parses on the JS side. Fires once on first note-open/search. Two **independent** wins —
either lands alone:

- (a) Tauri raw-bytes transport (`ipc::Response` / channel) instead of JSON-serialized `String`s.
- (b) Parallelize the file reads (rayon) — `collect_md` is a single-threaded DFS walk.

Medium risk (Rust + IPC contract). ~~Per-file double-stat collapse~~ — **dropped**: on macOS/Linux
`DirEntry::file_type()` reads `d_type` from `readdir` (syscall-free); only `metadata()` stats, so
the saving is ~0 and dropping `file_type()` would complicate the symlink-skip/dir-recursion
(`lib.rs:208,212`).

---

## P3 — `number[]`-over-JSON IPC amplifies attachments ~3–4× (desktop)

`TauriNoteStore.readAttachment` / `writeAttachment` (`tauriStore.ts:261-283`) move image bytes as
a JSON `number[]` — ~3–4× overhead per byte. With 124 MB of attachments, opening an image-heavy
note triggers several multi-MB IPC reads. Lift with the same raw-bytes transport as P2(a). Per-switch
cost for image-heavy notes; lower priority than P0.

---

## P4 — Every browse-settle rewrites the *whole* metadata sidecar

`persistMetadata({defer:true})` (`useNotes.ts:238`) debounces the active-pointer write (good), but
`active` is co-located with the `created` registry (one stamp per note) in `.gravity-notes.json`,
so each settle re-serializes + atomically writes ~150 KB (3000 stamps). Deferred, so a background
hitch, not a switch blocker. Fix: split the pointer into a tiny sidecar, or derive `created`
lazily. Lower priority.

---

## Gaps

- **Backlinks on hub notes (per-switch, situational).** `materializeBacklinks` runs per switch
  (`useBacklinks` stage 2); 0.14 ms for a low-link note, but a note that is the `[[link]]` target
  of hundreds of others slices hundreds of snippets on every open to it. Mitigation: cap/paginate
  backlinks or memoize snippet-by-id. Missed by the "everything else is sub-ms" sweep.
- **Attachment cache is fine under reuse.** The `AttachmentUrlCache` is per-store, **byte-budgeted
  LRU**, evicting oldest-first while skipping subscribed refs — it is *not* keyed per-note and does
  **not** forget on a switch in either the remount or `replace()` model, so the budget does not
  "creep" on switching. The only check (for tier C) is that NodeView `destroy()` unsubscribes — a
  pre-existing invariant, not a `replace()`-specific hazard.

---

## Recommended order

1. **Step 0** — measure editor-mount vs NotePreview-transform on `stress-notes-xl`.
2. **Tier B** — collapse browse coalescing (small, safe, immediate).
3. **P1 lazy preview** — free, independent; ship alongside.
4. **Tier A** — preview-while-browsing (if Step 0 says a single mount is costly).
5. **Tier C** — `editor.replace()` only if A is insufficient; hard-gate on history reset.
6. **Decoupled/parallel:** P2(a) raw-bytes and P2(b) rayon separately; P3; P4; backlink cap.

---

## Revision log

Revised 2026-06-29 after an independent review (Claude Opus 4.8), which verified every claim
against the tree at commit `054650b`. Adopted:

- **Measure-first (Step 0)** before any P0 surgery.
- **Three tiers (B → A → C)** instead of leading with the riskiest `editor.replace()`.
- **Undo-history promoted to the #1 P0 risk** (data integrity), above caret/focus.
- **P1 lazy-preview variant** as the preferred free win.
- **P2(a) and P2(b) decoupled**; **P2c double-stat dropped** (overstated on macOS).
- **Backlink-on-hub-notes gap** added.

Two points where the plan differs from the review:

- **Tier B formulation.** The review's literal "defer all opens to burst-settle" would regress
  single-press instant preview (the leading-edge "instant-preview feel", `useNoteNavigation.ts:40-42`).
  Refined to leading-edge + single-trailing: same churn reduction, no single-press latency.
- **Attachment "LRU creeps under reuse" concern.** Corrected: the cache is byte-budgeted LRU, not
  per-note, so it does not creep on switching in either model; only NodeView-destroy unsubscribe
  symmetry needs checking (tier C).

The "ProseMirror full-doc render vs CM6 viewport" gap (noted in memory) is about *very large single
notes* and is **not** the issue here — these notes are small. The issue here is editor *lifecycle*
(build/teardown per switch), which P0 addresses.

---

Stray untracked `.gravity-notes.json` in the repo root — looks like it leaked from a local run;
unrelated to this work.
