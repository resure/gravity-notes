# Code review: `feat/appearance-typography` vs `main`

Reviewed at max effort (10 finder angles → dedupe → adversarial verify → sweep).
Scope: `git diff main...HEAD` (appearance/typography feature — per-note appearance overrides,
text-width setting, per-font typography, self-hosted PT Serif, dark code highlighting, ledger-style
note-list redesign, reworked orb save-pulse). Tests pass and typecheck is clean.

**1 real correctness bug, plus a11y / efficiency / cleanup findings.** The per-note-appearance
feature is well-built, but it has one genuine data-loss gap.

## Findings (most-severe first)

### 1. Per-note appearance is silently lost on rename / move / move-folder — CORRECTNESS

`src/hooks/useNotes.ts:660` (also `:674`, `:611`)

The override lives in localStorage keyed by note id
(`gravity-notes:<wsId>:note:<noteId>:appearance`), and a note id *is* its POSIX rel-path.
`rename` migrates the metadata sidecar (`withRenamed`) and re-keys the in-memory row (`rekeyNote`)
but never migrates the appearance key; `move` / `moveFolder` (`withReprefixed`) don't either.

**Failure:** Open `Work/Plan.md`, set its font to Serif via the ⋯ popover, then rename it to
`Roadmap.md` (or move it, or move its folder). The note reverts to the inherited font and the
override is stranded under the old key forever (localStorage leak). Notably, per-note **icons**
*do* migrate because they live in the sidecar — so this is an inconsistency, not just a miss.

**Deeper fix:** store per-note appearance in the metadata sidecar (an `appearances` map alongside
`icons`), threaded through `withRenamed` / `withReprefixed` / `withRemoved` / `reconcile`, so it
inherits rename/move/remove/multi-backend behavior for free.

### 2. Folder-rail toggle lost its toggle state (a11y regression)

`src/components/NoteList.tsx:754`

The button was rewritten as a static `aria-label="Folders"` outlined button; `selected`,
`aria-pressed`, and the dynamic "Show / Hide folders" label were all dropped.

**Failure:** Whether the rail is open or closed, the button looks and reads identically. A
screen-reader user gets no state info, and a sighted user gets no feedback that pressing it again
will *close* the rail. (The test confirms this is deliberate, but no compensating state signaling
was added.)

### 3. `NoteAppearance.accentColor` is vestigial, yet `effectiveAppearance` honors it while `isOverridden` ignores it

`src/hooks/useSettings.ts:64` (and `:228`)

The field is kept "for uniform shape" but the popover never binds it, so it's always `'default'`.
However `effectiveAppearance` / `resolve` will apply a non-`'default'` value if one ever appears in
storage, while `isOverridden` explicitly excludes it.

**Failure:** A hand-edited or future-migrated key like
`{editorFont:'default', accentColor:'blue', textWidth:'default'}` would recolor that note's
orb / selection wash (overriding workspace + app), with **no Reset affordance** (the popover
wouldn't show Reset). Drop the field from `NoteAppearance`, or drive `isOverridden` generically.

### 4. Orb pulse gets stuck on under `prefers-reduced-motion`

`src/components/TopBar.tsx:199`

Under reduced motion the animation is `none`, so `onAnimationIteration` never fires; once a save
happens, `orbPulsing` stays `true` for the session (the comment's "lingers harmlessly" only holds
while reduced-motion stays on).

**Failure:** User has OS reduce-motion on, a save fires, then they turn reduce-motion off
mid-session — the orb resumes a phantom pulse with no save in progress. Low severity, but the
"harmlessly" claim isn't fully accurate.

### 5. PT Serif is always bundled (inlined) even though it's opt-in — EFFICIENCY

`src/main.tsx:27`

8 `@fontsource/pt-serif` faces (latin + latin-ext × {400, 700, italic, bold-italic}) are statically
imported. In `build:single` (CI), `viteSingleFile` base64-inlines every referenced asset — each
face CSS references both `.woff2` and `.woff`.

**Failure:** ~314 KB raw (~430 KB after base64) baked into `index.html` and shipped to every web
user on first paint, even those who never pick Serif. (Desktop is fine — browsers lazily fetch
`@font-face` only when the family renders.) Cheaper: one dynamic `import()` on first serif
selection, and/or drop the `.woff` fallbacks.

### 6. `ControlGroup` duplicates `ChoiceRow` — REUSE

`src/components/NoteAppearancePopover.tsx:92`

Both are "Text label + Gravity `SegmentedRadioGroup` bound to `{options, value, onUpdate,
aria-label}`," differing only in layout class. The option arrays were already extracted to
`appearanceControls.tsx`; the row wrapper is the un-deduplicated piece.

### 7. `useNoteSettings`' ref-mirror + imperative-persist dance can be a `key={noteId}` — SIMPLIFICATION

`src/hooks/useSettings.ts:191`

The `currentRef` + inline `localStorage.setItem` calls exist only because the hook survives a note
switch in place (so a persist-effect would write the old note's value under the new key). Keying
the consumer by `noteId` would let it mount fresh per note and reuse the plain persist-effect
pattern the other two hooks use — deleting the ref, the imperative writes, the reload effect, and
the mid-switch caveat comment.

### 8. Orb save-pulse JS state machine is over-engineered — SIMPLIFICATION

`src/components/TopBar.tsx:193`

~25 lines (state + ref + `useEffect` + `onAnimationIteration`) exist only to drop the `_pulsing`
class at an iteration boundary instead of mid-cycle. The keyframes already start and end at
`opacity:1`, so binding the class directly to `saveState === 'saving'` (or a short CSS
`transition`) gives an imperceptible difference for far less machinery.

### 9. Folder chip lost its top spacing

`src/components/NoteList.css:201`

`.note-list__folder`'s `margin-top: 1px` was deleted with a comment saying spacing now comes from
the `.note-list__text` column gap — but that gap is `0px`, so the rationale is wrong.

**Failure:** In All Notes / search, the folder crumb sits flush against the date · preview line
with no gap. Small (~1–2px) but the comment is misleading.

### 10. `ChoiceRow` dropped `size="s"`

`src/components/SettingsDialog.tsx:187`

The rewrite omitted the `size="s"` that was on the old picker, so Settings' font / accent /
text-width pickers now render at default `size="m"` while the per-note popover's identical controls
stay `size="s"` — inconsistent sizing for the same shared control. Likely an oversight (no comment
explains it).

### 11. Toolbar centering recipe duplicates the index.css block — REUSE

`src/components/EditorPane.css:41`

`width:100%; max-width:var(--gn-text-width); margin-inline:auto; box-sizing:border-box` is restated
verbatim for `.editor-pane_toolbar .g-md-flex-toolbar`, duplicating the grouped selector in
`index.css`. Fold it into that group and keep only the toolbar-specific `padding-inline` here.

---

## Dropped after verification

**Per-note appearance flashes to the previous note's font for one frame on switch** — REFUTED.
The editor content swap is itself a `useEffect` (keyed on `[sessionId, note.content]`) in the same
passive-effect flush as the appearance reload, and the `useLayoutEffect` that stamps `<html>` runs
before paint, so no painted frame shows note B's content under note A's attributes.
