# Block editor parity

## Current status (2026-10-28)

This document began as the 2026-10-16 parity audit. Its session summary and validation log below
record that run, not new checks. Later work resolved D13 (partial text selections across blocks),
the block-editor note-switch part of D12, and D19’s source tooling. Source undo across note
switches and history transfer between blocks and source remain deferred. See the updated entries
below and [architecture.md](../architecture.md) for the current behaviour.

## Session summary (2026-10-16)

Completed the audited scope on `block-editor-v2` on 2026-10-16. Every row below is implemented
with tests or explicitly deferred. Full old-editor parity is **not** claimed.

- Added YFM mark, underline, subscript, superscript and monospace; existing spellings survive editing.
- Added YFM notes and cuts with titles, kinds, nested content and original body spacing. Existing
  Obsidian callouts and HTML details retain their dialect. Newly inserted blocks keep the previous
  block editor's spelling; the decision is recorded in `docs/architecture.md`.
- Restored YFM preview for notes, interactive tabs, files, multiline tables, definition lists and
  inline marks. Preview now works from the current source buffer, including forced-source notes.
- Fixed IME DOM/key handling, literal link destinations and malformed percent escapes, lost link
  titles, Enter detaching a YFM note body, typed ordered-list starts, unsafe cross-block paste,
  dropped suffixes after image paste and parsing only part of a Markdown paste. Saved the initial
  delayed-drag fix as a separate commit. Added typed strike, mark and underline.
- Strengthened the guard for excessive depth and unsupported structural syntax. Literal wiki links
  and the `NoteStore` seam remain intact. Demo vault: **0/65 source fallbacks before and after**.
- Deferred complex YFM block authoring, full CommonMark parsing, extended source
  tooling and several interaction refinements with specific reasons below. No push, tag or release.

No human approval is required for the completed work. Rich HTML paste (D9) has since landed; the
next product choice is complex YFM authoring (D1–D4). macOS/WKWebView and real OS IME
qualification remain a separate hands-on check (D14).

## Evidence and priorities

Baseline: `f48953c6`; old app: `c86b0c8`, `EditorPane.tsx`, `package.json`, and the local editor
extensions for attachments, clipboard, wiki links, typed URLs, selection and external links.
The published **15.41.0** package was downloaded outside the repository and its actual
`build/cjs/presets/{full,yfm,default,commonmark,zero}.js` inspected. `full` adds Mark and Color to
YFM; Emoji is conditional and was not configured. YFM adds Deflist, Subscript, Superscript,
Underline, Checkbox, ImgSize, Monospace, Video, YfmConfigs, Cut, Note, File, Heading, Table and Tabs.
YfmConfigs enables **id attributes** by default; it is not a separate configuration-block grammar.
The old app set `md.html: false`, disabled fuzzy URL matching and enabled its own URL typing rule.
Math and footnotes are absent from the inspected preset chain. The old preview at `c86b0c8` also
omitted files/tabs: their missing preview was not introduced by this branch.

P0 = integrity/crash; P1 = daily writing or existing YFM files; P2 = specialised content.
Implemented baseline features are covered by `markdown.test.ts`, `Editor.test.tsx`,
`documentModel.test.ts`, `BlockEditorBody.test.tsx` and the storage/attachment suites. New coverage
also lives in `composition.test.tsx`, `links.test.tsx`, `yfm.test.tsx`, `typing.test.tsx`,
`paste.test.tsx` and `NotePreview.test.tsx`. Both seeded round-trip properties still run 20,000
seeds each; their grammar now includes YFM marks and containers.

### Syntax matrix

| Construct                                       | Target spelling                      | Result                                                                            | Priority |
| ----------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- | -------- |
| Paragraphs, soft breaks, intentional empty rows | Text, newline, `&nbsp;`              | Implemented; existing tests. A lone blank-row file remains guarded source.        | P1       |
| Headings H1–H6                                  | `#` through `######`                 | Implemented; existing tests                                                       | P1       |
| Bullets, ordered and nested lists               | `-`, numbered markers                | Implemented; typed starting number now retained                                   | P1       |
| Tasks                                           | `- [ ]` / `- [x]`                    | Implemented; existing tests                                                       | P1       |
| Quotes and rules                                | `>`, `---`                           | Implemented; existing tests                                                       | P1       |
| Fenced code and language                        | Original fence/info string           | Implemented; editor highlighting implemented (D11)                                | P1       |
| Bold, italic, strike and code                   | CommonMark / GFM                     | Implemented; typing and escape regressions added                                  | P1       |
| Links, autolinks and optional titles            | `[text](url "title")`, `<url>`       | Implemented; DOM sanitising retains titles                                        | P0       |
| Mark                                            | `==text==`                           | Implemented in blocks, typing and preview                                         | P1       |
| Underline                                       | Preserve `++text++` or `<u>`         | Implemented; existing underline command still writes `<u>`                        | P1       |
| Subscript / superscript                         | `~text~` / `^text^`                  | Single-word forms implemented; extended forms deferred D5                         | P2       |
| Monospace                                       | `##text##`                           | Implemented in blocks and preview; multiline forms deferred D5                    | P2       |
| Colour                                          | `{red}(text)`, `{bg:yellow}(text)`   | Implemented; grammar limitations deferred D18                                     | P1       |
| Images, attachment paths, alt and dimensions    | `![alt](src =100x)`                  | Implemented; existing tests, native interaction qualification D14                 | P1       |
| GFM tables, alignment and layout                | Original pipe-table spelling         | Implemented; header-column persistence deferred D17                               | P1       |
| Obsidian callouts                               | Preserve `> [!kind]` and fold marker | Implemented; existing tests                                                       | P1       |
| YFM notes                                       | Preserve `{% note kind "Title" %}`   | Implemented; parser, editor, generated and preview tests                          | P1       |
| HTML details                                    | Preserve `<details>` / `<summary>`   | Implemented; existing nested-toggle tests                                         | P1       |
| YFM cuts                                        | Preserve `{% cut "Title" %}`         | Implemented; expansion is session-only, as required by YFM                        | P1       |
| YFM tabs                                        | Preserve `{% list tabs %}`           | Preview implemented and browser-qualified; source authoring, block UI deferred D1 | P2       |
| YFM files                                       | Preserve `{% file … %}`              | Preview implemented; source authoring, block UI deferred D1                       | P2       |
| YFM multiline tables                            | Preserve `#\| … \|#`                 | Preview implemented; guarded source authoring, grid UI deferred D2                | P2       |
| Definition lists                                | Term followed by `: definition`      | Preview implemented; guarded source authoring, block UI deferred D3               | P2       |
| Heading anchors and id attributes               | Preserve `{#id}` / id attributes     | Trailing heading `{#id}` implemented; other `{#…}` guarded source, navigation D4  | P2       |
| Video                                           | Preserve original YFM                | Preview plugin enabled; block authoring and expanded qualification deferred D1    | P2       |
| Math / footnotes                                | Preserve original source             | Not in the old preset; rendering/structured authoring deferred D6                 | P2       |
| General HTML                                    | Preserve literal source              | Old app disabled HTML; executable rendering remains deferred D7                   | P2       |
| YAML frontmatter                                | Preserve source verbatim             | Guarded source implemented; structured metadata UI deferred D8                    | P0       |
| Setext / reference links                        | Preserve source                      | Explicit structural source guard tested; structured editing deferred D8           | P2       |
| Indented non-fenced code                        | Preserve source                      | Parser expansion deferred D8; source remains the authoring surface                | P2       |
| Optional emoji extension                        | Literal Unicode                      | Was not configured; Unicode editing remains supported, colon picker deferred D20  | P2       |

### Interaction and bug matrix

| Area                                              | Result / evidence                                                                                                        | Priority |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Delayed drag crash                                | Initial correction committed separately as `690d69d`; delayed-timer regression and Chromium drag pass                    | P0       |
| IME paragraph mutation and confirmation           | Fixed test-first; no rewriting/input shortcuts during composition, including key-code 229                                | P0       |
| IME table navigation                              | Fixed test-first; cells retain the composing DOM and ignore composition-owned navigation                                 | P0       |
| Relative links and malformed `%`                  | Fixed test-first; raw href policy and guarded attachment decoding                                                        | P0       |
| Link titles lost on unrelated edits               | Fixed test-first; title retained through sanitising                                                                      | P0       |
| Enter in a YFM note title                         | Fixed for empty/nonempty titles; existing body remains inside the container                                              | P0       |
| Preview from source / forced source               | Fixed test-first; unsaved buffer rendered and same textarea restored                                                     | P0       |
| Paste ending in image/table                       | Fixed test-first; text after the caret retained as a separate block when needed                                          | P0       |
| Paste crossing text blocks                        | Implemented; partial text retained at both ends (D13), with whole-block fallbacks                                        | P0       |
| First block of a Markdown paste                   | Fixed for an empty paragraph; headings, lists, tables and YFM note tested                                                | P1       |
| Unsupported multiline paste                       | Refused visibly with a source-mode hint; source accepts the original bytes                                               | P0       |
| Excessive nesting / false structural guard passes | Depth and unsupported-structure regression tests added; source fallback                                                  | P0       |
| Typing Markdown / numbered starts                 | Implemented with tests and Chromium typing; escaped/invalid delimiters stay literal                                      | P1       |
| Focus, caret and title handoff                    | Existing regressions pass; normal typing, collapsed cuts and toolbar exercised; native qualification D14                 | P1       |
| Undo/redo, StrictMode and note switching          | Block-editor history retained across note switches (D12); source-note and cross-mode history deferred                    | P0       |
| Cross-block copy/cut/delete                       | Implemented partial-text copy/cut/delete/paste and keyboard selection; whole-block fallbacks remain (D13)                | P1       |
| Markdown/plain/internal clipboard                 | Existing tests plus paste boundary regressions pass                                                                      | P1       |
| Rich HTML clipboard                               | Implemented (D9): `htmlImport.ts` maps structure and marks via the Markdown writer; corpus tests                         | P1       |
| Paste URL over selected text                      | Chromium native `execCommand` produces the expected anchor                                                               | P1       |
| Nesting, dragging and duplication                 | Subtree tests pass; real drag, keyboard move and duplicate exercised                                                     | P1       |
| Keyboard move of multiple selected roots          | Deferred D10; single-root move and multiple-root drag/duplicate remain available                                         | P2       |
| Slash / wiki menus                                | Existing regressions pass; browser slash-table and wiki insertion pass; extra Notion commands deferred D10               | P1       |
| Inline toolbar                                    | Chromium selection and Bold button pass; extra mark/sub/sup buttons deferred D5                                          | P1       |
| Tables, TSV paste and navigation                  | Existing matrix/grid tests and Chromium Tab/undo pass; IME fixed                                                         | P1       |
| Empty placeholders, handles, turn-into            | Existing component/menu regressions pass; browser furniture, slash and drag exercised                                    | P1       |
| Long documents / large tables                     | 5,000-paragraph and 150,000-row serialization audit passes; 2,000-block browser edit passed; virtualisation deferred D15 | P1       |
| Bare URL linkification                            | Implemented (D16): bare `http(s)://` URLs decorate as links, spelling kept; fuzzy domains stay text                      | P1       |
| Source syntax highlighting / advanced commands    | Implemented in CodeMirror with textarea loading/failure fallback (D19)                                                   | P2       |
| Spellcheck / image resize / file drop             | Existing inheritance/upload plumbing retained; hardware/native qualification deferred D14                                | P1       |

The comparison uses [Notion keyboard and Markdown shortcuts](https://www.notion.com/help/keyboard-shortcuts)
and [writing basics](https://www.notion.com/help/writing-and-editing-basics), checked 2026-10-16.
Keep the app's established shortcuts: `>` creates a Markdown quote; `⌘/` opens app help.

## Deferred work and reasons

- **D1 — tabs, files and video block authoring.** A tab group owns multiple independently editable
  bodies, and file/video nodes carry attributes absent from this flat text/image model. Mapping
  them to ordinary paragraphs would lie about their structure. Their YFM source stays editable;
  the preview handles the supported renderer grammar. Local file actions inside preview still
  follow its existing URL policy; a native attachment-opening control needs explicit plumbing.
- **D2 — YFM multiline-table editing.** Its cells can hold block content and merged structure;
  `TableData` is a rectangular inline-string grid. Converting it to GFM would discard capabilities.
  Use guarded source plus preview until a richer table model and conversion tests exist.
- **D3 — definition-list editing.** The current list model has no term/definition pairing. Flattening
  pairs into bullets would change semantics. Keep source plus rendered preview.
- **D4 — anchors/id attributes.** Trailing heading anchors (`## Title {#id}`, one or more) are held
  verbatim as heading metadata, outside the editable title, and shown as a muted `#id` chip after
  it. Clicking the chip edits the ids (clearing them removes the anchor); the block menu offers Add
  / Edit anchor on any heading. They survive title edits, level changes, duplicate and paste; a
  heading turned into another type stops writing its anchor but keeps it on the block, so turning
  it back restores it. Still deferred: `{#…}` anywhere else (mid-heading, in prose, `{ #id }` /
  `[{#id}]` spellings) stays guarded source, and local anchor navigation has no UI.
- **D5 — extended inline forms and controls.** Escaped whitespace in sub/sup, multiline mark runs
  and additional toolbar buttons need delimiter/selection semantics beyond the tested single-word
  scripts. Keep their literal/source spelling rather than inventing an alternative encoding.
- **D6 — math and footnotes.** Neither was enabled by the inspected full preset. Math would need a
  renderer and block model; footnotes need document-wide reference handling. No new rendering
  dependency was added merely because the old package had transitive KaTeX. Footnote definitions
  now explicitly select source; unsupported preview syntax can remain literal.
- **D7 — executable/general HTML.** The old app explicitly disabled raw HTML. Keep that behaviour;
  arbitrary HTML is not converted into executable editor nodes. Details and legacy inline underline
  remain the supported exceptions. Literal HTML can still be edited or viewed in source.
- **D8 — full CommonMark and structured frontmatter.** Setext, references, context-sensitive
  indented code and YAML need a broader document grammar than this line parser. No parser expansion
  was attempted for them. Explicit source guards cover the regression cases; canonical spelling
  normalisation is still the documented fallback check, not a complete CommonMark equivalence proof.
- **D9 — rich HTML paste.** Implemented after the parity pass. `htmlImport.ts` maps clipboard
  HTML (Google Docs, Notion, GitHub, Apple Notes, ordinary pages) to headings, nested lists, to-dos,
  quotes, fenced code with its language, tables and rules, keeping only allowlisted marks and safe
  absolute links. The result is written to Markdown and parsed back, so a paste holds exactly what
  the note reloads as. HTML carrying no more than plain text (a code editor's coloured lines) still
  yields to the plain/Markdown flavour. Images become alt text, or a link when standing alone;
  colours and underline are dropped rather than guessed.
- **D10 — remaining Notion commands.** Moving several disjoint selected subtrees by keyboard and
  `/turn`, `/color`, `/duplicate`, Alt-drag need clear ordering/selection semantics. Existing menus,
  single-block keyboard moves and multiple-block drag/duplicate cover the underlying actions.
- **D11 — editor syntax highlighting.** Implemented with the CSS Custom Highlight API
  (`codeHighlight.ts`): highlight.js tokens become painted ranges, so the editable DOM, caret, IME
  and undo are untouched, in the preview's palette. A highlight can only paint colour, so the
  preview's bold keywords stay plain in the editor.
- **D12 — history across note or source/block switches.** Partially implemented in
  `BlockEditorBody.tsx`: block-editor snapshots resume on returning to a note when their Markdown
  matches its content after trimming outer whitespace. The ten most recently left notes retain
  eligible histories (up to 256,000 characters per snapshot’s current Markdown); changed content
  starts fresh. `BlockEditorBody.test.tsx` covers switch-back undo and external-change rejection.
  Source history across note switches and blocks ↔ source history transfer remain deferred; the
  [original history proposal](preserve-undo-across-notes.md) describes the former editor.
- **D13 — partial text across blocks.** Implemented in `blockEditor/Editor.tsx`: copy/cut/delete,
  typing, Enter, paste and Shift-arrows preserve the unselected text at either end. `beforeinput`
  also handles edits without keydown. Non-text ends use whole-block fallbacks; inline formatting
  chords are ignored across blocks. `Editor.test.tsx` covers partial deletion, typing, Enter and
  undo. Accepted plain, rich and internal-block pastes now replace the range in one undo step;
  rejected payloads leave the selected text unchanged.
- **D14 — native/hardware interaction qualification.** Chromium interactions and synthetic IME
  tests ran; real OS composition, WKWebView caret/drag, native file dialogs and image resizing need
  hands-on qualification. Rust `cargo check` passed; no signed/notarized app or full DMG build ran.
- **D15 — editor virtualisation.** Every block stays mounted and every edit serializes the document.
  The volume audit checks correctness, not sustained typing latency, memory ceilings or screen-reader
  behaviour for very large vault notes. Those require a performance budget and a range-aware layout.
- **D16 — bare URLs in the editor.** Implemented (`urlDecorate.ts`) the way `[[wiki links]]` are:
  a style-only wrapper whose text is the URL, re-derived on every keystroke, so the file keeps the
  bare spelling. ⌘-click opens it and the caret tip offers Open. Explicit schemes only, like the
  preview; fuzzy domains remain disabled.
- **D17 — table header-column state.** GFM has no such spelling. The existing control is session-only
  and says so; persisting it requires choosing a richer table dialect, rather than hidden metadata.
- **D18 — colour grammar.** Unbalanced parentheses have the same limitations as the YFM extension;
  there is no portable colour syntax. Existing token spelling is retained rather than changed.
- **D19 — source tooling.** Implemented in lazy-loaded `SourceEditor.tsx` (CodeMirror): Markdown
  and fenced-code highlighting, find/replace, list continuation and source editing shortcuts, with
  app chords left to the shell. `TextareaSource` remains the loading/failure fallback. Source
  content isolation and buffer/focus behaviour are covered by `BlockEditorBody.test.tsx` and
  `SourceEditor.test.tsx`. Source/block undo transfer is still deferred under D12.
- **D20 — emoji picker.** The optional old Emoji extension was not configured. Native Unicode
  input still works; a Notion-style colon picker is not necessary for the verified baseline.

## Validation and progress log

1. Baseline: 52 files / 1,159 tests; typecheck, lint, formatting and web build passed. Saved the
   initial user diff in `/private/tmp/gravity-notes-initial.patch`.
2. `169eefa`: IME and link-destination regressions; `0822018`: YFM inline marks.
3. `93e9383`: YFM note/cut containers, title Enter regression, generated grammar coverage.
4. `fc43c3f`: preview grammar and live source preview. File/tabs packages were already installed
   transitively; direct declarations introduced no new resolved versions. Main JS gzip grew from
   about 895.75 kB at baseline to 899.72 kB after the preview change.
5. `17b0a18`: typing, paste boundaries, link titles and depth safety. `690d69d`: the initial
   delayed-drag correction, kept separate from other work. Initial colour-swatch changes remain
   uncommitted and untouched.
6. The final guard sweep reproduced five false structural passes, then tested guarded source for
   multiline YFM tables, definition lists, setext headings and reference/footnote definitions.
7. Both property tests run 20,000 seeds. Demo vault read-only audits before, between and after
   changes all report **0/65** fallbacks. No demo or personal note was written.
8. Chromium: heading/bold typing, mark/underline, numbering from 7, wiki insertion, slash table,
   table Tab/undo, YFM note/cut editing, real deferred drag, cross-block replacement, inline toolbar,
   URL over selection, keyboard move/duplicate and switching preview tabs passed. No JavaScript
   errors; existing Vite dependency-externalisation warnings remained.
9. Node volume audit: 5,000 paragraphs and 150,000 table rows serialized/reparsed successfully
   (587 ms in this local run; no performance guarantee). Native shell: locked offline
   `cargo check` passed with Rust 1.96. Single-file web qualification and final counts follow below.

10. Final checks: **57 test files / 1,232 tests passed**, typecheck, lint (zero errors),
    formatting, normal web build and `build:single` passed. These checks preceded the final commit.
11. Chromium opened 2,000 blocks and accepted typing in the last one (`Paragraph 1999 edited`),
    with all 2,000 blocks retained. This is a correctness smoke check, not a latency budget.
