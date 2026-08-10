# PLAN — Sol: rewrite Gravity Notes onto Base UI + the block editor

> **Status:** Passes 0–6 are DONE and on `block-editor`. Only **Pass 7** (mobile & iOS polish,
> explicitly deferrable) remains. Work happens on the current branch; the project moves to a fork
> later. This plan is self-contained: an agent picking up any single pass should read **Context**,
> **Decisions**, the pass's own section, and **Invariants** — and consult the design bundle for
> pixel truth.

## Context

Gravity Notes is being rewritten into **Sol**: a full visual + component redesign that replaces the
entire Gravity UI ecosystem (`@gravity-ui/uikit`, `@gravity-ui/icons`,
`@gravity-ui/markdown-editor`) with **`@base-ui/react` 1.7** for behavior and ~100% our own CSS for
looks — and drops the rich (ProseMirror) editor entirely, keeping only the vendored Notion-style
block editor as the note body. Nothing about the data model changes: notes stay `.md` files on
disk / IndexedDB behind the `NoteStore` seam, folders stay directories, the sidecar stays.

**Sources of truth** (in the repo, `design_handoff_notes_base_ui/`):

- `Notes - Base UI Handoff.dc.html` — the v2 spec, every screen at 1:1 (open in a browser with
  `support.js` beside it). Sections: 01 Brief · 02 Principles · 03 Foundations · 04/04b Shell ·
  05 List row · 06 Editor · 07 Menus · 08 Settings · 09 States · 10 iOS · 11 Component inventory ·
  12 Keyboard · 13 Build order.
- `README.md` there — accurate summary of the spec; the two `*.dc.html` micro-mocks are decision
  records (serif titles; quiet scope header).
- This plan resolves the spec's internal contradictions and adapts it to one deviation the spec
  didn't know about: **the rich editor is dropped**, not kept (spec §06/§11 assumed
  `@gravity-ui/markdown-editor` stays — every "editor stays ProseMirror" line is overridden).

**Verified:** `@base-ui/react@1.7.0` is real and current on npm (React 17/18/19 peer). All parts
the spec references exist: `menu`, `context-menu`, `dialog`, `alert-dialog`, `popover`, `select`,
`switch`, `toggle-group`, `combobox`, `input`/`field`, `toast`, `tooltip`, `collapsible`,
`progress`, `scroll-area`, `separator`. (Spec correction: 1.7 _does_ ship a `button` part; we still
hand-roll our Button CSS, optionally on top of it.)

## Locked design decisions (handoff v2 — do not relitigate)

- One accent: **amber**, fixed (light `oklch(0.70 0.14 62)`, dark `oklch(0.78 0.13 68)`). The
  accent picker is **gone**. Permitted accent uses on desktop: focus ring, active toggle segment,
  hyperlink, sync dot, text selection. Menu/hover highlights are **neutral**.
- **Dark is ink** (oklch lightness 0.15–0.235, hue 75), paper is the _lightest_ dark surface.
- **PT Serif 400** (+ italic), **Cyrillic-complete**, bundled locally: note titles, H1/H2 in the
  editor, and the serif body option. All chrome is system SF. Verify every surface with RU strings.
- Appearance inheritance: **app default → per-note**. The workspace layer is **cut**.
- **Note icons feature is cut** (picker, per-row glyph, Settings toggle).
- Note list gets a 38px **scope header** (folder name · count · sort · "+ New") and
  **time-group labels** (Pinned/Today/Yesterday/Earlier); rows are **58px fixed** (virtualizer
  contract); breadcrumbs stay gone.
- Save toasts die; a **sync dot + word** in the title bar carries save state. Toast only for
  genuine failures.
- Focus mode hides the two panes only; title bar + search stay.
- Frameless window, 44px title bar, panes 236 / 324 / fill; editor measure 680px.
- Motion: `--dur-0/1/2/3` = 0/110/170/240ms; selection **never** animates; only three "signature"
  moments move (note-switch crossfade, block-drag tilt, pane collapse).
- Theme = `data-theme` on `<html>` + one media query for System. **No ThemeProvider, no
  data-accent.**

## Decisions taken in this plan (user delegated — flag if wrong)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Source editor stays**, as the block editor's existing raw-Markdown mode (plain `<textarea>`, ⌘⇧; toggles Blocks ↔ Source). No CodeMirror.                                                                                                                                                                                                                                                           | Spec §12 keeps ⌘⇧;. The textarea mode already exists in `BlockEditorBody`. CM6 is a backlog upgrade, not a rewrite dependency.                                                                                                                                   |
| D2  | **Round-trip fallback → source mode.** A note failing `isRoundTripStable` opens in the raw source view with a one-line notice ("Contains Markdown blocks can't represent — editing as source"), not in blocks.                                                                                                                                                                                        | Preserves the safety property (never rewrite a file the parser reads imperfectly) with an _editable_ surface. Widening the block model (fence language, H4–H6, callout kinds, table alignment) is post-rewrite backlog that shrinks the fallback population.     |
| D3  | **Keep `@diplodoc/transform` (+ color/cut extensions) for NotePreview and UpdateDialog.** Import its base CSS directly (see Pass 0). Restyle `.yfm` output with Sol tokens.                                                                                                                                                                                                                           | Preview must render full CommonMark — including exactly the notes blocks can't hold (D2's fallback population). Replacing it with a block-model render would be wrong for those notes by construction. These three packages are markdown-it tooling, not UI-kit. |
| D4  | **[REVISED after review]** Theme control stays in the **Orb menu** — spec §07's Orb mock has a "Theme — System" row (between "Toggle sidebar" and "Settings…"), so no deviation is needed; the earlier draft misread the mock. Desktop Settings gets NO theme row; iOS Settings keeps its Theme Light/Dark/System group per §10 (Pass 7).                                                             | Zero-deviation; the current app's theme control also lives in the orb menu, so it never disappears between passes.                                                                                                                                               |
| D5  | Settings rows "**Editor: Markdown/Blocks**" and "**Show editor toolbar**" are **cut** (they configured the rich engine). Desktop Settings becomes a **single Appearance section**: Editor font (Sans/Serif/Mono) · Text width (Narrow/Default/Wide/Unlimited) — §08's 620px geometry, live-commit, 22% scrim all stay.                                                                                | Blocks is the only engine; it has no sticky toolbar (format bar is selection-anchored). Theme is Orb-owned per D4.                                                                                                                                               |
| D6  | **⌘L stays "focus search"; ⌘K stays "previous note"**. The search field's keycap chip renders **⌘L**, not the mock's ⌘K.                                                                                                                                                                                                                                                                              | Spec §12 ("nothing here changes") contradicts the §04 mock's ⌘K chip; §12 wins — ⌘K is taken by note navigation, ⌘⇧K by insert-link.                                                                                                                             |
| D7  | **[USER-DECIDED]** On-disk tokens rename WITH compat: sidecar → **`.sol-notes.json`** (migrated from `.gravity-notes.json` on vault open, see Pass 6), folder marker → **`.solkeep`** (both markers recognized indefinitely, new writes use the new name). Also rename: localStorage keys → `sol:*`, IndexedDB names → `sol` / `sol-data`, and delete the now-dead legacy browser-storage migrations. | The bundle-id change gives the desktop app a fresh WKWebView origin anyway (and the fork's web origin is new), so browser-storage renames cost nothing extra. The vault-file renames carry a real migration, specced in Pass 6.                                  |
| D8  | **[USER-CONFIRMED]** Clean break on app identity — no cross-app (WKWebView/browser) data migration. First Sol launch boots to the folder gate; users re-pick their vault (sidecar migration in D7/Pass 6 then restores pins/sort/trash/appearance). In-browser-storage users export from Gravity Notes → import into Sol. Say this in the release notes.                                              | WKWebView storage is keyed by bundle id; migrating another app's container is fragile/undocumented. The valuable data lives in vaults and survives.                                                                                                              |
| D9  | **[USER-DECIDED]** Tauri identifier = **`net.resure.sol`** (dev: `net.resure.sol.dev`), iOS = **`net.resure.sol.app`** (confirmed; mirrors the current `net.resure.gravitynotes.app` convention — nothing has been App-Store-submitted, so the change is safe).                                                                                                                                       | Reverse-DNS per user.                                                                                                                                                                                                                                            |
| D10 | **[USER-DECIDED]** Fork repo is **`github.com/resure/sol`** — updater endpoint, AboutDialog `GITHUB_URL`, release scripts all point there. **Keep the updater minisign keypair.** Old installs keep polling the old repo; that's correct (they're a different app now).                                                                                                                               | New pubkey would be pointless churn; same signing identity is fine for a new lineage.                                                                                                                                                                            |
| D11 | **Keep `scripts/scope-css.mjs`** (spec §11 wrongly says it fences Gravity globals — it actually scopes the vendored block editor's generic class names like `.page`/`.block`). Optional backlog: rename those classes and drop the script.                                                                                                                                                            | Removing it would leak `.page`/`.content`/`.block` styles app-wide.                                                                                                                                                                                              |
| D12 | **Keep** `@gravity-ui/eslint-config` / `@gravity-ui/prettier-config` (dev-only tooling, ships nothing). Swap later if desired.                                                                                                                                                                                                                                                                        | Zero user-facing footprint; not worth destabilizing the diff.                                                                                                                                                                                                    |
| D13 | Sidecar `icons` map **keeps flowing through parse/serialize/rename/trash** even though the icons UI is deleted.                                                                                                                                                                                                                                                                                       | Vaults may still be opened by old Gravity Notes during transition; dropping the field from serialize destroys data on first write.                                                                                                                               |
| D14 | **Trash in the folder rail** (spec §04 shows it at the rail's foot) opens the existing Trash dialog. Making Trash a scoped list view is backlog.                                                                                                                                                                                                                                                      | Keeps the redesign shippable; the spec's §11 inventory itself keeps Trash as a Dialog.                                                                                                                                                                           |
| D15 | Wiki-link **tooltip (retarget/edit)** ports after the picker; the picker (`[[` → Combobox), amber render, broken-link styling, and ⌘-click follow are required; tooltip may land a pass later.                                                                                                                                                                                                        | Ordered by user value; the tooltip's presentation component survives as-is and can be re-driven any time.                                                                                                                                                        |
| D16 | **[USER-DECIDED]** The **web build stays a target** through the rewrite (Chromium FSA + in-browser storage, `build:single` included); "go Tauri-native / drop web" remains a separate post-rewrite decision (backlog).                                                                                                                                                                                | Keeps the rewrite's scope pure; every pass verifies all three backends as the verification section says.                                                                                                                                                         |
| D17 | **[USER-DECIDED]** Sol launches as **1.0.0**: Pass 6 sets the version across `package.json` / `tauri.conf.json` / `Cargo.toml` (the `bump-version` script touches all three) and starts a fresh CHANGELOG whose 1.0.0 entry explains the D8 clean break + the D7 vault migration. New updater lineage starts at 1.0.0 — no installed base, so no baseline gotchas.                                    | New app, new lineage; 1.0 marks the redesign as the product.                                                                                                                                                                                                     |
| D18 | §07's note ⋯ menu carries two rows that are **new features**: "Export this note…" = single-note `.md` save/download reusing `transfer.ts` serialization (note file only; bundling referenced attachments is backlog), and "Copy link to note" = copies the **`[[Title]]` wiki-link text** (no URL scheme exists; a `sol://` deep link is backlog). Both land in Pass 3 with the menu.                 | Minimal spec-compliant readings; flag if either should be richer or deferred.                                                                                                                                                                                    |
| D19 | §06's wiki picker "Create …" row is **insert-only**: committing it inserts the literal `[[query]]` (renders broken-styled until the note exists) — it does not create the note file. Notion-style create-on-commit is backlog.                                                                                                                                                                        | Minimal reading of the mock; consistent with existing broken-link behavior. Flag if create-on-commit is wanted.                                                                                                                                                  |

## What goes / what stays

**Deleted** (runtime): `@gravity-ui/uikit`, `@gravity-ui/icons` (+ the lazy icon catalog),
`@gravity-ui/markdown-editor`, `@gravity-ui/components`, `@emoji-mart/data`,
`@diplodoc/file-extension`, `@diplodoc/tabs-extension`, `@codemirror/*`, `prosemirror-*`,
`highlight.js`†, `katex`, `lowlight`, `markdown-it`†. Components: the whole rich `EditorBody`
(EditorPane lines ~1–582), `editor/selectionContextFix.*` (and its exact-version pin reason),
`editor/markupHistory.*`, `editor/attachmentImageExtension.ts`, `editor/openLinkExtension.ts`,
`editor/linkifyTypedUrls.ts` (keep pure `trimTrailingPunctuation`), `editor/wikiLinkExtension.ts`,
`editor/wikiSuggest.ts`, `editor/attachmentImageView.*` (dies by absorption — Pass 0 item 5 ports
its features into `blockEditor/AttachmentImage.tsx`), `IconPicker.*`, `src/icons.ts`,
`NoteAppearancePopover` (folds into the note ⋯ menu), `appearanceControls` accent parts,
workspace-settings layer. NOT deleted from `editor/`: `WikiLinkSuggest.tsx`, `WikiLinkTooltip.tsx`,
`wikiLink.css` (re-scoped) — presentation kept, re-driven per Pass 0. (There is no `ThemeSwitcher`
component — theme control is orb-menu items + `theme.ts`, and it stays per D4.)

† verify first: if `@diplodoc/transform`'s code highlighting or its markdown-it dependency is
direct, they stay as transitive deps of D3 — only _our_ package.json entries go.

**Added**: `@base-ui/react@^1.7`, `src/tokens.css`, `src/ui/` (primitives + Base UI wrappers),
`src/ui/icons/` (hand-drawn SVG set), PT Serif cyrillic subsets, `src/listGroups.ts` (time
grouping), block-editor wiki-link authoring, sync-state title-bar indicator.

**Untouched** (the point of the seam): `src/storage/*` (except D7's key renames + the Pass 6
sidecar/marker migration),
`src/hooks/useNotes.ts`, `useCorpus`, `useNoteNavigation`, `useNoteSearch`, `useBacklinks`,
`useShortcuts` (+ `src/shortcuts.ts` map — descriptor wording updates in Pass 0 excepted),
`useListboxNav`, `useNotesStorage` (except Pass 6 strings), `useSwipeBack`,
`useIsNarrow`, `src/search.ts`, `src/wikiLinks.ts`, `src/tree.ts`, `src/markdown/*` (except
`inline.ts` IF Pass 0's wiki-render option B adds the span↔`[[…]]` pair), `src/attachments.ts`,
`src-tauri/` (except identity/config + the D7 marker/sidecar constants in Pass 6, and chrome
colors), the watcher, transfer (except Pass 6's marker compat + D18's single-note export reuse),
workspaces/multi-window, the iOS `icloud-fs` plugin.

---

## Pass 0 — Drop the rich engine, finish the block editor (feature work, pre-design)

_Ships: the app runs blocks-only with no feature cliff. Still looks like Gravity Notes._

This is ordered first because it shrinks every later pass (582 lines of EditorPane, the vendored
selection fix, 13 packages, 9 stylesheet imports all die) and it's the highest-regression-risk
work — do it while the old UI and its test suite are still around it.

1. **Fallback (D2):** in `EditorPane.tsx`, replace the `activeEngine` guard (`:616-629`) — a note
   failing `isRoundTripStable` forces `BlockEditorBody` into source mode for that session, with a
   quiet notice line. Remove the `engine` prop chain (`useSettings.editorEngine`, `ENGINE_OPTIONS`,
   Settings row, `Workspace.tsx:1594`, `editor-pane_blocks` modifier — promote its
   `--editor-gutter: 36px` onto `.editor-pane` unconditionally).
2. **Preview CSS decoupling (D3):** import `@diplodoc/transform/dist/css/base.css` +
   `_yfm-only.css` directly in `main.tsx`; delete the nine `@gravity-ui/markdown-editor/styles/*`
   imports; vendor the small `--yfm-*` variable maps the preview still needs (`yfm-themes`,
   `yfm-overrides`, `yc-colors` for the color extension). Keep the dark hljs remap
   (`index.css:167-177`). Verify preview + UpdateDialog render styled.
3. **Adapter gaps** (`BlockEditorBody.tsx`): wire `Editor`'s existing `onEscape` into the pane's
   Esc ladder; implement a real `openLineAbove()` (insert-block command on the editor handle);
   port the rich body's `viewStateByIdRef` **scroll + caret save/restore** keyed by note id
   (re-key on rename, like `EditorPane.tsx:410` does today).
4. **Wiki-link authoring in blocks** (reuse, don't rebuild: `src/wikiLinks.ts` is 100% pure;
   `WikiLinkSuggest.tsx`/`WikiLinkTooltip.tsx` are presentation-only and survive with a new
   driver):
   - **Render contract (critical — blocks re-serialize the WHOLE doc from `el.innerHTML` on
     every keystroke):** render `[[Title]]` as a styled link span EITHER (A) as a style-only
     wrapper whose text content stays the literal `[[Title]]` bytes — zero serialization work,
     the recommended default — OR (B) bracket-less like the mock, which REQUIRES the explicit
     inverse pair: a `span.wiki-link` → `[[…]]` rule in `inlineHtmlToMarkdown` AND the md→html
     side in `inlineMarkdownToHtml`, with `markdown.test.ts` round-trip cases (plain, inside
     bold/italic, adjacent to code). **A post-render DOM decorator is forbidden** — it passes
     `isRoundTripStable` (which is pure) yet the live DOM serializes bracket-less, so the first
     edit anywhere silently rewrites every `[[Title]]` to `Title` across the file. (`NotePreview`'s
     `withWikiLinks` hides brackets and is a model for the read-only preview only, not for the
     editable surface.) Broken state styled from the corpus (`wikiNotes` prop — pass it to blocks
     like the rich body got it).
   - `[[` trigger → suggest popup driven off `suggestWikiTargets` (trigger machinery template:
     the slash menu, `Editor.tsx:1441-1466` + `caret.ts`'s `caretLineRect`); Gravity `Popup`+`List`
     presentation for now, swapped to Base UI Combobox in Pass 4. Per §06 the picker's **last row
     is always `Create "<query>"`** when no exact match exists — the driver keeps the popup open
     on zero/partial matches (the old `wikiSuggest.ts` closed on empty) and committing it inserts
     the literal `[[query]]`, insert-only per D19.
   - unify `Editor.tsx`'s local `wikiLinkAt` with `wikiLinks.ts` `normalizeTarget` (they diverge
     on `|`/`#` handling).
   - **Bare URLs:** blocks have no linkify — decide the minimum here: `<url>` autolinks and bare
     URLs should at least render clickable (the rich engine linkified them); a typing-time
     linkify port (`trimTrailingPunctuation` is pure and reusable) is optional — if skipped,
     record it in Known limitations.
5. **Attachment image parity:** port `editor/attachmentImageView.tsx`'s drag-resize, alt/caption
   editing, click-to-zoom (keep `Lightbox.tsx`), and broken/loading states into
   `blockEditor/AttachmentImage.tsx` (`ImageData.width` field already exists, nothing writes it).
6. **Deletions:** rich `EditorBody`; from `editor/`: `wikiLinkExtension`, `wikiSuggest`,
   `linkifyTypedUrls` (extract `trimTrailingPunctuation` first), `openLinkExtension`,
   `attachmentImageExtension`, `attachmentImageView.*` (after item 5's port), `markupHistory.*`,
   `selectionContextFix.*` (+ its test) — keeping `WikiLinkSuggest.tsx`, `WikiLinkTooltip.tsx`,
   `wikiLink.css` (re-scoped to `.gn-block-editor`); `EditorPane.css`
   `.g-md-*`/`.cm-editor`/`.ProseMirror` sweeps; `Workspace.test.tsx`/`EditorPane.test.tsx`
   markdown-editor mocks (EditorPane's suite needs a substantial rewrite — its
   fake-editor/toolbar/scroll tests are rich-specific). **Packages dropped HERE** (rich-engine
   deps only): `@gravity-ui/markdown-editor` (the exact pin goes with it), `@gravity-ui/components`,
   `@diplodoc/file-extension`, `@diplodoc/tabs-extension`, `@codemirror/*`, `prosemirror-*`,
   `katex`, `lowlight`, and `highlight.js`/`markdown-it` if the † check clears them.
   `@gravity-ui/uikit`, `@gravity-ui/icons`, `@emoji-mart/data` stay until Pass 5.
7. **Docs:** rewrite `docs/architecture.md` "Two editors" → "The editor" + Known limitations
   (blocks-first world, source fallback), README features, and `docs/shortcuts.md` + the
   `SHORTCUTS` descriptor for rich-only entries: ⌘⇧; description → "Blocks ↔ Source", and the
   ⌘⇧K "Insert link" row re-points at the block editor's link affordance (its `SelectionToolbar`
   has a link input) or is removed — don't leave a dead row in the ⌘/ sheet.

Verify: `npm test`, `npm run build`, open the demo vault (`~/Documents/Gravity Notes Demo`) —
every note opens (blocks or source, never silently rewritten: `git status` on the vault after
open+close must be clean), preview styled, images resize/zoom, `[[` picker works, ⌘Z sane.
**Edit-time rewrite check** (catches the C3 decorator trap the open/close check can't): open a
wiki-link-bearing note, type one character, save — `git diff` on the vault must show only that
edit, no `[[…]]` → bare-title rewrites.

## Pass 1 — `src/tokens.css` (ship before any component work)

_Ships: the whole app changes color, nothing changes shape._

Create `src/tokens.css` with the §03 values verbatim, as `:root` + `[data-theme="dark"]`
re-declaration (System needs no media-query variant in CSS — the `data-theme` stamping effect
below resolves it in JS; Gravity's ThemeProvider still emits `.g-root_theme_*` until Pass 5, so
scope the dark block under BOTH `[data-theme="dark"]` and `.g-root_theme_dark`):

```css
/* Light */
--bg-desk: oklch(0.94 0.008 75);
--bg-panel: oklch(0.968 0.006 75);
--bg-panel-2: oklch(0.982 0.004 75);
--bg-paper: oklch(1 0 0);
--text-1: oklch(0.24 0.014 75);
--text-2: oklch(0.45 0.014 75);
--text-3: oklch(0.62 0.011 75);
--text-4: oklch(0.74 0.009 75);
--line: rgba(62, 54, 42, 0.08);
--bg-hover: rgba(62, 54, 42, 0.04);
--bg-selected: rgba(62, 54, 42, 0.065);
--accent: oklch(0.7 0.14 62);
--accent-soft: oklch(0.7 0.14 62 / 0.14);
--danger: oklch(0.58 0.2 26);
/* Dark: desk .15/.006 · panel .19/.007 · panel-2 .21/.007 · paper .235/.008 (paper is LIGHTEST);
   text 0.94/0.72/0.58/0.46 (chroma ~1.7× light); line rgba(255,255,255,.09);
   hover .05 white; selected .08 white; accent oklch(0.78 0.13 68) */
/* Radii: --r-xs 4 (chips) · --r-sm 6 (buttons/fields) · --r-md 8 (menus/rows) · --r-lg 12 (dialogs) · --r-xl 16 (iOS sheets) */
/* Shadows 1–4 per §3.4, EVERY floating surface carries inset 0 1px 0 rgba(255,255,255,.9) (dark: .06); dark alphas deepen to ~.5 */
/* Type scale: --fs-label 9.5/14 mono .13em caps · --fs-meta 11/14 · --fs-ui-sm 12/16 · --fs-time 12/16 tabular ·
   --fs-preview 12.5/17 · --fs-menu 13.5/18 · --fs-ui 14/19 (500 rest / 600 selected) · --fs-body 15/24 ·
   --fs-h2 20/27 PT Serif 400 · --fs-h1 28/34 PT Serif 400; ≥13.5px carries letter-spacing -0.003em; counts/dates tabular-nums */
/* Motion: --dur-0 0ms · --dur-1 110ms · --dur-2 170ms · --dur-3 240ms ·
   --ease cubic-bezier(.2,.8,.2,1) · --ease-in cubic-bezier(.4,0,1,1) */
```

Then the **bridge** — two halves (a correction from review: `index.css` remaps only ~15 unique
`--g-*` names — brand/link/selection colors, dark `base-background`/`base-generic`, `line-brand`,
`font-family-sans`; it does NOT remap text-primary/secondary/hint, generic lines, or danger —
those come from the uikit stylesheet untouched):

1. Re-point the ~15 existing `index.css` remaps at the new tokens.
2. ADD a new bridge block overriding the uikit-stylesheet variables that still-Gravity chrome
   actually consumes, under both `.g-root_theme_light`/`.g-root_theme_dark` AND the `[data-theme]`
   scopes: at minimum `--g-color-text-primary/-secondary/-hint/-complementary` → `--text-1/2/3/4`,
   `--g-color-base-background`/`-float`/`-generic(+hover)`/`-simple-hover` →
   `--bg-desk/panel/paper/hover`, `--g-color-line-generic` → `--line`,
   `--g-color-base-danger`/`--g-color-text-danger` → `--danger`, plus whatever a visual sweep of
   still-Gravity surfaces shows off-palette. Without half 2, Pass 1's "whole app changes color"
   claim is false — menus, dialogs, and primary text would keep stock uikit colors.

**Stamp `data-theme` from day one:** add a tiny `App.tsx` effect mirroring the theme pref onto
`<html data-theme>` (System resolves via `matchMedia`) alongside the still-present ThemeProvider.
This makes every `[data-theme]` selector live in Passes 1–4 (the block editor's Pass 4
re-tokenization depends on it) while `.g-root_theme_*` keeps serving Gravity until Pass 5.

Keep `--gn-orange`/`--gn-orb-halo`/`--gn-accent-rgb` as aliases of `--accent` (26 usages across
7 files consume them). Update `index.html`'s anti-flash colors to the new desk values (light
`oklch(0.94 0.008 75)` ≈ `#eeece8`, dark ≈ `#26241f` — compute exact sRGB at implementation) —
the inline style AND the Rust-side `apply_macos_chrome` background must match.

Also here: extend `src/fonts/pt-serif.css` with **cyrillic + cyrillic-ext** faces matching the
latin set (400/700 + both italics — cyrillic-400-only would leave RU bold synthetically emboldened
while latin bold is real; keep the woff2-only rule and its single-file-build rationale), and
delete the accent-picker CSS (`[data-accent]` blocks, `index.css:187-197`) — amber is now the
only accent.

## Pass 2 — Primitives (`src/ui/`)

_Ships: nothing visible. Do not skip — this is where portal stacking and the material get proven._

- `src/ui/Button.tsx` + CSS — variants `quiet` / `raised` / `filled`. Filled appears **exactly
  once** in the app (folder gate). Raised = the §04 recipe (white bg, 1px line, shadow-1, inset
  top highlight; dark inverts: inputs darker-with-inner-shadow, raised lighter-with-6%-highlight).
- `src/ui/Icon.tsx` + `src/ui/icons/*.tsx` — hand-drawn single-stroke SVG set on 12/15/16/19
  boxes, plus a single 26px box at 1.3 stroke for empty-state glyphs (§11 rules; stroke ~1.2–1.4;
  pins/dots are the only filled glyphs; B/I/S/H1/H2/`<>` are 600-weight letterforms at 0.8× the
  neighbor icon box, not icons). Inline components, not a font. ~30 needed — enumerate them by
  grepping `from '@gravity-ui/icons'` across `src/` (35 distinct icons in 14 files today; note
  the icon-picker catalog in `src/icons.ts` dies with the icons cut and needs no replacements);
  the block editor's `blockEditor/icons.tsx` already follows this style — extend it, don't
  duplicate.
- `src/ui/Menu.tsx` (Base UI Menu + ContextMenu), `src/ui/Dialog.tsx` (+ AlertDialog),
  `src/ui/Popover.tsx`, `src/ui/Select.tsx`, `src/ui/Switch.tsx`, `src/ui/ToggleGroup.tsx`,
  `src/ui/Input.tsx` (Field+Input), `src/ui/Tooltip.tsx`, `src/ui/toast.tsx` (Toast provider +
  imperative `toast({title, content, tone, actions})` helper mirroring the current
  `useToaster().add` call sites) — each wrapped **once** with the shared material: `--r-lg` 12px,
  1px `--line`, `--shadow-3`, 6px padding, 32px rows, 16px icon column, 13.5px labels, right-
  aligned `--text-4` shortcut hints, inset divider before a single destructive item, popups scale
  from 0.97 with transform-origin at the trigger, out in half the in-duration. Tooltips: 26px,
  420ms delay, 0ms for neighbors (Tooltip.Provider `delay`/`closeDelay`).
- `src/ui/Kbd.tsx`, `Chip.tsx` (18px, 4px radius — the folder-scope chip; §11's EXP variant has
  no remaining use after D5's cuts, so build it only if something needs it), `Banner.tsx` (one
  layout, three tones — replaces Alert for ConflictBanner), `Skeleton.tsx` (list skeleton rows;
  spinner survives only for attachment upload).
- **Portal + stacking contract:** all floating parts portal to `document.body`;
  `isolation: isolate` on the app root; verify menus stack above the Tauri drag region. Every
  wrapped floating surface carries a shared class (`.ui-pop`) — then **ADD** `.ui-pop` to the
  `closest('.note-title-row, .g-popup, [role="dialog"]')` guard in `Workspace.tsx` (grep for
  `.g-popup`; asserted in `Workspace.test.tsx:633`). Do NOT remove `.g-popup` from the selector
  until Pass 5 — Gravity popups keep rendering through Pass 4.
- **Contracts to keep** (things the codebase relies on today):
  - `useShortcuts` suppresses global chords while `document.querySelector('[role="dialog"]')`
    matches — Base UI Dialog renders `role="dialog"` and unmounts on close by default; do NOT use
    `keepMounted`.
  - Dialogs need `initialFocus`-equivalent (Base UI: `initialFocus` prop on Popup) for
    MoveTo/Workspace-switcher filter inputs; `useListboxNav` stays document-level.
  - Base UI Dialog owns scroll lock properly — delete the `disableBodyScrollLock` workarounds
    (spec §08 calls this out).
  - `useHeldValue` exists for Gravity's ~150ms close animation; Base UI keeps elements during CSS
    transitions too — keep the hook.
  - Focus must return to the row/trigger that opened a menu or dialog (§12 "two things to watch");
    the folder rail stays a plain roving-tabindex tree, NOT a Base UI Menu (typeahead would eat
    `n`, `j`, `k`).
  - Menu items must distinguish click vs Enter modifiers (⌘-click "open in new window" reads
    modifier flags off both mouse and keyboard events — `TopBar.tsx:395-398` pattern).
- Test infra: `src/test/render.tsx` only **ADDS** the new Toast provider alongside the three
  Gravity providers — components under test stay on Gravity through Pass 4 (uikit's `useToaster`
  THROWS outside `ToasterProvider`, and Gravity portals need `ThemeProvider`; 13 suites use
  `renderWithProviders`, so dropping the providers here would fail `npm test` until Pass 5).
  The Gravity-provider removal happens in Pass 5's App-shell step. Keep the `matchMedia` stub,
  `ResizeObserver` stub, and the `.virtual-scroll` `offsetHeight` hack (renaming that class
  silently empties every list test).

## Pass 3 — The shell

_Ships: the app looks new. The pass people judge._

Rebuild, per §04/§05 geometry (all values are in the spec at 1:1 — measure there, not here):

- **Title bar** (`TopBar.tsx` + CSS): 44px, whole bar = drag region except controls. Traffic
  lights: system-positioned via the existing NSToolbar trick — never hand-position (macOS 26
  reverts it); accept the system inset, which is approximately the mock's 18px. Two 26px pane
  toggles, then the **Orb** (19px flat amber disc in a 26px target). **Orb menu, exhaustive per
  §07 + existing features**: workspace list at top · Workspaces… (⌃R — opens the switcher dialog)
  · Open Folder… (⌘-click = new window) · Export / Import · Attachments · Trash · Reload notes ·
  Toggle sidebar (⌘\) · **Theme — System/Light/Dark (D4: stays here per §07)** · Settings… (⌘,) ·
  Shortcuts (⌘/) · Check for Updates · About. Centered 404×27 search field (placeholder "Search
  or create a note…", **⌘L** keycap per D6). Right side: **sync dot + word** (7px dot, 3px halo)
  mapped from `useNotes`' actual `SaveState` (`'idle'|'saving'|'saved'|'error'|'conflict'`):
  saved/idle → amber "Saved" · saving → dim amber "Writing" · error → red "Failed" · conflict →
  red + the banner. The spec's gray "offline" has no source in a local-first app — deliberately
  omitted. Delete save toasts. Then the note **⋯ menu, exhaustive per §07**: Font + Width
  ToggleGroup strips ("Default" = inherit; non-focusable group outside the arrow-key ring;
  replaces `NoteAppearancePopover`, ⌘⇧I opens the menu) · Read-only preview (⌘⇧P) · Edit as
  source (⌘⇧;, D1) · Pin to top · Rename (F2) · Move to… (⌘⇧M) · Duplicate (⌘D) · Reveal in
  Finder · **Export this note… (NEW, D18)** · **Copy link to note (NEW, D18: copies `[[Title]]`)**
  · Delete (⌘⇧⌫, destructive, below the inset divider). Keep the mobile one-row contract
  (slot-preserving `visibility:hidden` placeholders, safe-area insets).
- **Folder rail** (`FolderRail.tsx`): 236px default width, rows 32px/14px/500, one 18px column
  inset, 12px indent steps with hairline guides, mono `--fs-label` group labels ("Library",
  "Folders"), All Notes row, counts right-aligned tabular, pin glyphs, hover ⋯ (ContextMenu =
  same menu), **Trash row at the foot** (D14) + 36px "New Folder" footer row. Rail stays a
  roving-tabindex tree (n/j/k/F2/⌫ intact). Delete-folder disabled-with-tooltip when non-empty
  (Base UI keeps disabled items focusable).
- **Note list** (`NoteList.tsx`): 324px, 38px scope header (folder name 14/600 · count ·
  "Updated ⌄" quiet Select — options = the current app's sort modes; the mock's extra "Folder"
  grouping option is backlog · raised 24px "+ New" — the app's only raised control), **time-group
  labels** via new pure `src/listGroups.ts` (+ tests): Pinned/Today/Yesterday/Earlier following
  the active sort (title sort → letter groups). **58px fixed rows**: title 14/19 (500→600
  selected) + time 12/16 tabular (swapped for a 24px ⋯ target on hover), preview 12.5/17 one
  line. States per §05: neutral hover/selected washes, selected-but-focus-elsewhere darker step,
  hover suppressed adjacent to selection, rename-in-place (no field chrome, amber text selection),
  skeleton rows. Keep: virtualization (`@tanstack/react-virtual`, group labels = 26px items via
  per-index `estimateSize`), the `rangeExtractor` that pins the focused row + open-menu anchor
  row, ONE shared row menu (now Base UI Menu/ContextMenu — right-click at cursor comes free),
  right-click/⌘-click never move selection, the `:focus` (not `:focus-visible`) selected-wash
  rule (programmatic `.focus()` — deliberate, don't "modernize").
- **Search behavior**: verify the inline-autocomplete contract (§12: top match completes inline,
  Tab accepts) — if the current box doesn't do inline completion, add it here; ranked search
  itself (`useNoteSearch`) is untouched.
- **Workspace layout** (`Workspace.css`): re-tint panes desk/panel/panel-2/paper; tint steps, no
  border between panes; pane collapse at `--dur-3` with a hair of overshoot; focus mode = both
  panes hidden, bar stays. Keep the three body-modifier collapse/peek/mobile classes and the
  ≤700px push-nav + swipe-back untouched (restyle only). Keep `@media (hover: hover)` gating and
  `touch-action: manipulation` on all new interactive rows.
- 2px amber focus ring, 2px offset, `:focus-visible` only, app-wide (`tokens.css` utility).

## Pass 4 — Editor chrome

_Ships: the writing surface. Lean on the block editor's existing tests._

- Restyle `blockEditor/editor.css` with Sol tokens (its `--g-*` color references and
  `.g-root_theme_dark` hooks → `--text-*`/`--bg-*`/`[data-theme]` — the `data-theme` attribute is
  live since Pass 1's stamping; the Notion palette's `--n-ink` channel gets re-derived from
  `--text-1`). Body 15/24; H1 (note title) PT Serif 28/34/400 —
  title and body keep one left edge (`--editor-gutter`); H2 PT Serif 20/27/400; measure 680px
  centered; per-font `--gn-editor-*` metric blocks stay (serif = PT Serif at adjusted metrics).
- Block gutter per §06: drag handle (left) + insert (right) at −54px from the measure, 22×24
  targets, 12px glyphs, hidden at rest, tooltips after 420ms; hovered-block wash 2.8% with 6px
  bleed; block drag = 2° tilt under `--shadow-3`.
- Slash menu, block menu, selection format bar → restyle to the one §07 material (12px radius,
  32px rows). They stay hand-rolled (they're caret-anchored and already portaled via
  `OverlayPortal`); only the wiki **suggest** swaps presentation to Base UI **Combobox** (driver
  from Pass 0 stays; delete the Gravity `Popup`+`List` presentation), and the block menu may move
  to Base UI Menu if it costs nothing — otherwise CSS-only.
- Wiki links render **amber** (never browser-blue), broken-link state, tooltip port (D15) on
  Base UI Popover.
- **Linked references**: replace `BacklinksPanel` placement with the §04 bottom bar — 40px,
  pinned to the editor pane, Base UI **Collapsible**, expands to 300px max with own scroll.
- Preview badge, conflict banner (→ `ui/Banner`, three tones, not self-dismissible), note-switch
  crossfade + 2px rise at `--dur-2` (respect `prefers-reduced-motion`).
- Keep: `.editor-pane`'s `translateZ(0)` (WKWebView ghost-paint fix), the Esc ladder, caret-
  preserving `focus()` in `BlockEditorBody`, `sessionId` remount model, per-note appearance
  stamping (`data-editor-font`/`data-text-width` on `<html>`; `data-accent` is gone).

## Pass 5 — Dialogs, states, and the last Gravity import

_Ships: `@gravity-ui/_` runtime deps drop out of package.json.\*

- Rebuild on `ui/Dialog`: Settings (620px, single Appearance section per D4/D5, 150px label
  column, 22% scrim, live-commit, no Save), Shortcuts (keep `SHORTCUTS` descriptor + platform
  substitution),
  About, Attachments (keep virtualized list), Trash, MoveTo + WorkspaceSwitcher (keep
  `useListboxNav` + `initialFocus` + pre-highlight seeding), Update (Progress; release notes still
  `@diplodoc/transform`). Delete-confirms → AlertDialog. FolderGate: redesigned per §09 — the
  app's only filled Button, recents list stays, no Card, delayed spinner → skeleton.
- §09 empty/loading/error states: per-pane, never full-window; one oversized quiet glyph max;
  skeleton rows; no spinner under 400ms.
- **Settings model** (`useSettings.ts`): delete `showEditorToolbar`, `showNoteIcons`,
  `accentColor` + `AccentColor*` machinery, and the whole workspace layer (`WorkspaceSettings`,
  `useWorkspaceSettings`, `loadWorkspaceOverrides`, SettingsDialog workspace section) —
  `editorEngine` already died in Pass 0; `effectiveAppearance` collapses to note→app. Theme
  stays App-owned (Orb menu per D4; keep the single `sol:theme` key + anti-flash pairing).
  Keep `usePersistedSettings`'s merge-into-freshest multi-window write.
- **Icons cut** (D13): delete `IconPicker.*`, `src/icons.ts`, row/title glyph rendering,
  Settings toggle, `@emoji-mart/data`; keep sidecar `icons` field flowing through
  `metadata.ts` transforms untouched.
- **App shell** (`App.tsx`): drop ThemeProvider/MobileProvider/Toaster* — `data-theme` stamping
  is already live since Pass 1, it just stops being a mirror (System = media query listener; keep
  `getCurrentWindow().setTheme()` and the index.html anti-flash pairing). Base UI Toast provider;
  ErrorBoundary stays; **keep the ⌘0 `menu:main-window` listener in App** (it must live in App,
  not workspace-keyed `Workspace` — the documented duplicate-listener altitude bug). Same step:
  `src/test/render.tsx` finally drops the Gravity providers (deferred from Pass 2), the `.g-popup`
  term leaves the `Workspace.tsx` closest-guard, the `--g-*`bridge from Pass 1 is deleted, the
uikit stylesheet import goes,`vite.config.ts`'s `server.deps.inline: [/@gravity-ui\//]` goes,
and the remaining packages drop (`@gravity-ui/uikit`, `@gravity-ui/icons`, `@emoji-mart/data`).
- Storage-key renames (D7): `sol:theme`, `sol:settings`, `sol:<wsId>:*`,
  `sol:backlinks-collapsed`; IDB `sol` (registry) / `sol-data` (notes); delete
  `readLegacyNoteAppearances`, the legacy un-namespaced layout keys, and the registry v1→v2
  migration (fresh origins make them dead code). Update the storage tests' literals.

## Pass 6 — Rename to Sol

_Ships: the fork identity. (Timing flexible; before the first Sol release, after Pass 5 is
cleanest — the release tooling keeps working for smoke builds meanwhile.)_

Use the rename-surfaces inventory (agent report, condensed):

- **Identity:** `tauri.conf.json` (`productName: "Sol"`, `identifier: "net.resure.sol"` per D9,
  window `title`), `tauri.dev.conf.json` (name "Sol Dev", `net.resure.sol.dev` — mirror the whole
  windows block, it REPLACES not merges), `tauri.ios.conf.json` (`net.resure.sol.app`),
  `package.json` name `sol`, `index.html` title + favicon data-URI, Cargo.toml
  description/authors (crate names stay `app`/`app_lib`), `gen/apple/*`
  PRODUCT_NAME/BUNDLE_IDENTIFIER + xcscheme BuildableName. **Version → 1.0.0** everywhere the
  `bump-version` script reaches (D17), fresh CHANGELOG.
- **On-disk token migration (D7)** — the one part of this pass with real data-loss stakes;
  applies to the two folder backends only (in-browser storage is clean-break per D8):
  - **Sidecar:** new canonical name **`.sol-notes.json`**. On vault open, at the store's first
    metadata read: if `.sol-notes.json` is absent and `.gravity-notes.json` exists → read the
    legacy file and immediately write its contents as `.sol-notes.json`. The legacy file is left
    in place untouched (old Gravity Notes installs opening the same vault keep working) and is
    never read again once the new file exists; if both exist, the new one wins unconditionally.
    Touch points: `metadata.ts` `METADATA_FILENAME` (+ a `LEGACY_METADATA_FILENAME`), the
    read path shared by `fileSystemStore` + `tauriStore`, and Rust `lib.rs`'s own
    `METADATA_FILENAME` const — grep every usage (e.g. the folder-emptiness sidecar skip); each
    must recognize **both** names. The migration carries everything the sidecar holds — pins,
    sort, created stamps, per-note appearance, the **trash registry**, and the dormant `icons`
    map (D13).
  - **Folder marker (three constants, not one — review finding):** new writes emit **`.solkeep`**,
    legacy `.gnkeep` recognized indefinitely. (a) **Rust `lib.rs` has its OWN
    `FOLDER_MARKER`** — desktop folder ops go entirely through the Rust commands, `tauriStore`
    never sees the TS constant: rename it + add a legacy twin; `notes_create_folder` writes the
    new name; `notes_remove_dir` treats BOTH names as ignorable-then-removable markers (else
    desktop keeps writing `.gnkeep` forever and can't delete a `.solkeep` folder made on web).
    (b) `fileSystemStore.removeFolder` drops BOTH marker names before its non-recursive
    `removeEntry` (else web can't delete legacy `.gnkeep`-only folders). (c) `noteText.ts`
    `FOLDER_MARKER` + legacy twin; `transfer.ts` export writes the new name, import accepts both.
    Note: the two `isPrunable` emptiness checks need NO marker change — they keep a folder on
    ANY non-sidecar entry; only their sidecar-name skip gets the dual-name treatment above.
  - **Tests:** update the literals in `metadata.test.ts`, `tauriStore.test.ts`,
    `fileSystemStore.test.ts`, `noteText.test.ts`, and the Rust tests in `lib.rs`; add migration
    cases (legacy-only → migrated once; both present → new wins; fresh vault → new name only;
    auto-prune spares a `.gnkeep`-only folder; **removeFolder deletes a `.gnkeep`-only folder
    on BOTH the Rust and FSA paths**).
- **Strings:** FolderGate welcome, AboutDialog (+ GITHUB_URL → fork repo), ErrorBoundary,
  UpdateDialog ×3, Workspace `document.title` + toast copy, `useNotesStorage` native titles +
  `showDirectoryPicker({id})`, `transfer.ts` default zip name (`sol.zip`), `main.tsx` boot error.
- **Release tooling** (⚠ review finding — these are two DIFFERENT URLs, don't cross them):
  `scripts/build-mac-release.sh`'s `UPDATER_URL` is the **tarball asset URL embedded INTO
  latest.json** (the archive installed apps download + signature-verify) →
  `https://github.com/resure/sol/releases/download/v${VERSION}/Sol_${VERSION}_aarch64.app.tar.gz`;
  the **endpoint** `https://github.com/resure/sol/releases/latest/download/latest.json` belongs
  ONLY in `tauri.conf.json`'s `plugins.updater.endpoints` (D10: same pubkey). Pointing
  `UPDATER_URL` at latest.json would ship a manifest whose download URL is the manifest itself —
  breaking auto-update for the whole install base at the first patch release, and no dry-run
  catches it. Also: `RAW_TARBALL` MUST equal productName (`Sol.app.tar.gz`), artifact names,
  `scripts/make-latest-json.mjs` fallback text, **both** `.claude/skills/release/SKILL.md` and
  `.agents/skills/release/SKILL.md` (near-duplicates — update both, incl. the
  `osascript quit app` name).
- **Icons:** new art from `icon-source.svg` (geometry-only, no text — a "Sol" sun mark; dev
  variant stays blue). Follow the CLAUDE.md rasterization gotcha (transparent 1024px PNG,
  flood-fill the white `qlmanage` background) → `npx tauri icon`, delete android/ios/64x64
  extras, regenerate the Apple asset catalog.
- **Docs:** README (name, screenshots, philosophy line loses "built on Gravity UI"), CLAUDE.md +
  AGENTS.md (both — near-duplicates; document the sidecar/marker migration), docs/architecture.md
  ("What's on disk" section: new sidecar name + legacy compat), CHANGELOG note explaining D8's
  clean break and the vault migration. **Do not touch:** the `gravity-notes-test-` temp prefix in
  Rust tests (harmless), memory files.
- `--gn-*` CSS var prefix → cosmetic; rename to `--sol-*` only if trivial after Pass 5's sweeps
  (remember `EditorPane.tsx:771` holds a selector _string_ and `index.html` boot classes pair
  with the inline script).

## Pass 7 — Mobile & iOS polish (deferrable)

The ≤700px push layout, swipe-back, and one-row top bar survive Passes 3–5 restyled; this pass
adds §10's platform work: 66px rows / 44px targets, 52px floating compose button, block toolbar
pinned above the keyboard (44px targets, 19px icons + 15/600 letterforms, home-indicator
clearance), long-press block lift (2° + shadow) replacing the gutter, iOS sheet styling
(`--r-xl`, inset grouped lists), accent = bare tappable words only, iOS Settings gains its Theme
Light/Dark/System group per §10 (desktop keeps theme in the Orb, D4; the per-workspace Settings
section is already gone since Pass 5 — nothing to drop here). Android inherits tokens later;
Windows title-bar layout is an explicitly open spec item — decide before any Windows build (does
not block macOS).

---

## Invariants (do not break — the codebase's load-bearing subtleties)

1. `useShortcuts` ⟷ `[role="dialog"]` presence contract (no `keepMounted` dialogs).
2. Punctuation chords match `event.code` (⌘⇧; → `Semicolon`) — keep when touching shortcuts.
3. `useListboxNav` is document-level by design; callers own filtering/highlight.
4. NoteList: right-click/⌘-click never move selection; `:focus` wash not `:focus-visible`;
   `rangeExtractor` pins focused + anchor rows; one shared row menu instance.
5. StrictMode: never retire live resources in effect cleanup keyed to nothing (watch double-run
   legality; see the refcounted watcher).
6. Blank lines must survive load/save round-trips — the block pipeline preserves empty rows by
   design; don't "normalize" them away when touching `src/markdown/`.
7. `.editor-pane` compositing layer (`translateZ(0)`); `OverlayPortal` re-applies the scope class
   (host pane has a `transform` — `position: fixed` overlays must portal).
8. Wiki links reach disk as literal Obsidian bytes, never escaped; `<br>` saves as plain newline.
9. Every `:hover` rule wrapped in `@media (hover: hover)`; `touch-action: manipulation` on taps.
10. Multi-window localStorage writes merge-into-freshest (`usePersistedSettings`) — keep for the
    app layer even after the workspace layer dies.
11. The round-trip guard runs once per session and its failure must always land on an editable,
    non-rewriting surface (D2).
12. `notes:changed` payload `dir` strict-equals the raw path the frontend passed; don't touch the
    watcher while restyling.
13. Tests: `.virtual-scroll` offsetHeight stub class; `matchMedia`/`ResizeObserver` stubs;
    dialog focus traps swallow `userEvent.type` in jsdom (drive controlled inputs directly).

## Verification (every pass)

`npm run lint && npm run typecheck && npm test && npm run build && npm run build:single`, then
`npm run tauri:dev` against the demo vault (`~/Documents/Gravity Notes Demo` — 69 notes, images,
wiki-links, pins) and a browser run (`npm run dev`, Chromium, both storage kinds). Check per pass:
both themes at parity (dark is ink, paper lightest), RU strings on every changed surface, keyboard
map unchanged (`⌘/` sheet vs `src/shortcuts.ts` vs `docs/shortcuts.md`), focus ring everywhere,
no white flash on dark launch (anti-flash pairing), menus above the drag region, `git status`
clean in the vault after open/close of every note (no silent rewrites). Pass 6 additionally:
`/release`-skill dry run (build + sign only); fresh-profile first-run → folder gate → re-pick a
legacy vault → `.sol-notes.json` appears beside the untouched `.gravity-notes.json` and
pins/sort/trash/appearance all survive; a `.gnkeep`-only empty folder survives open/close. Final: the packaged-app self-diagnosing
recipe from memory for prod-only Tauri chrome issues.

## Open items

1. Windows title-bar layout (spec's own open item) — irrelevant until a Windows build exists.

_(Resolved by the user 2026-08-09: identifier `net.resure.sol` / dev `net.resure.sol.dev` / iOS
`net.resure.sol.app`; fork repo `github.com/resure/sol`; clean-break data stance accepted;
sidecar → `.sol-notes.json` migrated on vault open + `.solkeep` with legacy compat; web target
stays; Sol launches as 1.0.0 — see D7–D10, D16–D17.)_

## Post-rewrite backlog (explicitly out of scope)

Widen the block model to shrink the source-fallback population (fence language first, then H4–H6,
callout kinds, table alignment, frontmatter-as-block — each must extend `markdown.test.ts` and
keep `isRoundTripStable` as backstop) · CodeMirror 6 source mode · code syntax highlighting in
blocks · KaTeX · Trash as a scoped list view · wiki-picker create-on-commit (D19) + a `sol://`
deep-link scheme for "Copy link to note" (D18) · per-note export bundling referenced attachments
(D18) · typing-time linkify in blocks (if Pass 0 ships the minimum) · the sort menu's "Folder"
grouping option · rename block-editor CSS classes and drop `scope-css.mjs` · `--gn-*` → `--sol-*`
sweep · resizable panes · drop-web/FSA decision (D16) · Windows/Android.
