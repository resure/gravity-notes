# Code review — `various-fixes`

Scope: `git diff main...HEAD` (6 fixes + icon work). The high-risk logic (per-note
scroll/caret, the reimplemented heading Select, the custom Rust menu, the anti-flash paint)
was verified against the `@gravity-ui/markdown-editor` bundle internals and the enclosing
functions.

No crashers or data-loss bugs. Several plausible-looking candidates were **refuted** and are
listed at the bottom so they don't get re-raised.

## Findings

Ranked most-severe first. Correctness/behavior above cleanup.

### 1. Scroll not reset when switching between two notes with identical content

- **File:** `src/components/EditorPane.tsx:353` (guard) / `:366` (deps)
- **What:** The per-note scroll restore (fix #5) is skipped when you switch between two
  _different_ notes whose bodies are byte-identical, so the new note opens at the old note's
  scroll position — the exact bug fix #5 targets.
- **Why:** The content-swap effect has deps `[note.content]` and early-returns on
  `if (editor.getValue() === note.content) return;`. With identical content the effect never
  runs, so `saveViewState` / `restoreSelection` / the `scrollContainerRef.scrollTop = …` reset
  (lines 354–364) never execute. The `[note.id]` re-key effect can even re-map note A's saved
  caret onto note B.
- **Fix idea:** Key the swap on `note.id` as well as `note.content`, or perform the
  scroll/top-reset in the `[note.id]` effect so a real switch always re-homes the scroll.

### 2. Heading Select drops hotkey badges, previews, hints, and aria-labels

- **File:** `src/components/EditorPane.tsx:91` (`renderOption`)
- **What:** `SelectionHeadingSelect` renders only icon + text per option. The bundle's original
  `ToolbarSelect` (`node_modules/@gravity-ui/markdown-editor/build/esm/bundle/toolbar/ToolbarSelect.js:14-17`)
  wraps each option in `<PreviewTooltip>`, sets `aria-label={text}`, and shows a `<Hotkey>` badge
  (e.g. ⌘⌥1) plus a `HelpMark` hint.
- **Impact:** Users lose heading-shortcut discoverability and the style preview; screen-reader
  labels are weaker. A UX/a11y regression vs the repaired control (still better than removing it).
- **Fix idea:** Restore at least the `Hotkey` badge and `aria-label` in `renderOption`.

### 3. Custom `build_menu` omits standard macOS Window items

- **File:** `src-tauri/src/lib.rs:747` (Window submenu)
- **What:** `build_menu` replaces the entire default menu; the Window submenu adds only
  minimize/maximize/close, so "Bring All to Front" (and the automatic window list) are gone.
- **Impact:** Low — the core Edit/View/Window/Quit accelerators are preserved via
  `PredefinedMenuItem` — but it's a fidelity gap vs the `Menu::default` it mirrors.

### 4. `ReleaseNotes` duplicates `NotePreview`'s Markdown render

- **File:** `src/components/UpdateDialog.tsx:97`
- **What:** Both `NotePreview.tsx:117` and `ReleaseNotes` call `transform(x).result.html` with a
  try/catch and render via `dangerouslySetInnerHTML`.
- **Impact:** The transform's escaping/sanitization policy is now a two-point sync — a change
  (enabling raw HTML, adding a plugin) must be mirrored in both. Extract a thin
  `renderMarkdown(md)` helper.

### 5. `menu:about` listener duplicates the `useNotes` Tauri-listen boilerplate

- **File:** `src/components/Workspace.tsx:276`
- **What:** The dynamic-`import('@tauri-apps/api/event')` + `disposed` flag + `unlisten` ref +
  disposal-check pattern is copied verbatim from the close-request listener in `useNotes.ts`.
- **Impact:** Two copies of the same teardown protocol. A `listenTauri(event, cb)` helper would
  DRY both and make the cleanup a single point of change.

### 6. `SelectionHeadingSelect` rebuilds options/renderOption every render

- **File:** `src/components/EditorPane.tsx:86`
- **What:** On every toolbar render (each selection change) `items.find(isActive)`,
  `items.map(...)` (7 allocations), and a fresh `renderOption` closure are recreated, though
  `wHeadingListConfig.data` is static.
- **Fix idea:** Hoist `options`/`renderOption` to module scope (or `useMemo`); only the
  active-item lookup is state-dependent.

### 7. Dark background `#211e1a` hardcoded in three places

- **File:** `index.html:24` + `src-tauri/src/lib.rs:807` (mirror `--g-color-base-background` in
  `src/index.css`)
- **What:** Three sources of truth for the dark base background.
- **Impact:** Retuning the dark background in `index.css` silently drifts from the HTML/Rust
  copies, reintroducing a startup flash on one surface. CLAUDE.md documents the coupling, and a
  shared token is genuinely hard here (HTML/Rust paint before CSS loads) — so at minimum keep the
  doc note tight and the values in lockstep.

## Not filed

- **Unbounded `viewStateByIdRef` map** — grows one small object per distinct note opened in a
  session; negligible in practice.
- **Test mocks missing `wHeadingListConfig`** — type-only usage + the component isn't rendered in
  tests, so the suite passes.

## Refuted candidates (do not re-raise)

- `transform().result.html` "undefined crash" — the transform reliably returns an html string
  (matches `NotePreview`'s established usage), and React renders `{__html: undefined}` harmlessly.
- `.editor-pane` not being the scroll container — it **is** (`overflow-y: auto`,
  `EditorPane.css:92`), so fix #5 targets the right element.
- `SELECTION_MENU_CONFIG` shape crash — the config is confirmed an array-of-arrays
  (`ContextConfig = ContextGroupItemData[][]`), so `.map(group => group.map(...))` is correct.
- `ids[0]` undefined crash — the original `ToolbarSelect` destructures `([id]) =>` identically,
  and `items.find(...)?.exec` guards the call.
- Workspace listener "double-call" in StrictMode — the `disposed`/`unlisten` if/else is the
  correct idiomatic pattern (each effect run has its own closure).
- `as never` cast in `restoreSelection` — guarded by try/catch around `Selection.fromJSON`.
- `event.id() == "about"` — compiles (`cargo check` passes); muda's `PartialEq` is stable API.
