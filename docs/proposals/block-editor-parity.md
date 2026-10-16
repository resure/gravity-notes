# Block editor parity

## Session summary

Work in progress on `block-editor-v2`. Preserve the round-trip guard and literal wiki links;
unsupported syntax remains editable in source. No release or push is part of this work.

## Evidence and priorities

Baseline: `f48953c6`. Old application: `c86b0c8`, `EditorPane.tsx` and its local extensions.
The published **15.41.0** package was downloaded to a temporary directory and its actual
`build/cjs/presets/{full,yfm,default,commonmark,zero}.js` inspected. `full` adds Mark and Color
to YFM; Emoji is conditional. YFM adds Deflist, Subscript, Superscript, Underline, Checkbox,
ImgSize, Monospace, Video, YfmConfigs, Cut, Note, File, Heading, Table and Tabs.
The app set `md.html: false`, disabled fuzzy URL matching, and supplied attachment, clipboard,
wiki, URL-opening and typed-link extensions. Math and footnotes must not be inferred from “full”.

P0 = data integrity/crash; P1 = daily writing or existing YFM files; P2 = specialised content.
“Existing” means covered by the baseline tests; “open” requires work or an explicit decision.

### Syntax

| Construct                                       | Baseline block surface                          | Target spelling                       | Priority / status                    |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------ | --- | ------- |
| Paragraphs, soft breaks, intentional empty rows | Existing tests                                  | Plain text, newline, `&nbsp;`         | P1 existing                          |
| Headings H1–H6                                  | Existing tests                                  | `#` through `######`                  | P1 existing                          |
| Bullets, ordered lists, nested lists            | Existing tests                                  | `-`, numbered markers; preserve start | P1 existing                          |
| Tasks                                           | Existing tests                                  | `- [ ]` / `- [x]`                     | P1 existing                          |
| Quotes, rules, fenced code and language         | Existing tests                                  | `>`, `---`, original fence/info       | P1 existing                          |
| Bold, italic, strike, code, links               | Existing tests                                  | CommonMark, GFM strike                | P1 existing                          |
| Mark                                            | Parser + editor tests                           | `==text==`                            | P1 implemented                       |
| Underline                                       | Both spellings tested                           | Preserve `++text++` or `<u>`          | P1 implemented                       |
| Subscript / superscript                         | Parser + editor tests                           | `~text~` / `^text^`                   | P2 implemented (single-word scripts) |
| Monospace                                       | Parser + editor tests                           | `##text##`                            | P2 implemented (single-word scripts) |
| Colour                                          | Existing tests                                  | `{red}(text)`, `{bg:yellow}(text)`    | P1 existing                          |
| Images, attachment URLs and dimensions          | Existing tests                                  | `![alt](src =100x)`                   | P1 existing                          |
| GFM tables, alignment, padding                  | Existing tests                                  | Preserve pipe-table layout            | P1 existing                          |
| Obsidian callouts                               | Existing tests                                  | Preserve `> [!kind]` and fold marker  | P1 existing                          |
| YFM notes, title, nested content                | Parser, editor and generated tests              | Preserve `{% note kind "Title" %}`    | P1 implemented                       |
| HTML details and nested toggles                 | Existing tests                                  | Preserve `<details>` / `<summary>`    | P1 existing                          |
| YFM cuts                                        | Parser, editor and generated tests              | Preserve `{% cut "Title" %}`          | P1 implemented                       |
| YFM tabs                                        | Unsupported; preview plugin removed             | Preserve `{% list tabs %}`            | P2 open                              |
| YFM files                                       | Unsupported; preview plugin removed             | Preserve `{% file … %}`               | P2 open                              |
| YFM multiline tables                            | Unsupported                                     | Preserve `#                           | …                                    | #`  | P2 open |
| Definition lists                                | Unsupported                                     | `Term` followed by `: definition`     | P2 open                              |
| Heading anchors                                 | Explicit source fallback                        | Preserve `{#id}`                      | P2 open                              |
| Video / YFM configuration blocks                | Unsupported                                     | Preserve original YFM                 | P2 open                              |
| Math and footnotes                              | Not in preset chain inspected                   | Preserve source                       | P2 open                              |
| HTML blocks                                     | Disabled in old app; details special-cased here | Preserve source                       | P2 open                              |
| YAML frontmatter                                | Source fallback                                 | Preserve source verbatim              | P0 existing guard                    |
| Setext headings, indented code, reference links | Source fallback / literal                       | Preserve source                       | P2 open                              |

### Interaction and bug audit

| Area                                                  | Baseline / next verification                                          | Priority / status        |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| Delayed drag state                                    | Pre-existing uncommitted fix and regression test; preserve separately | P0 existing local change |
| Focus, caret, title handoff, collapsed blocks         | Existing regressions; browser exercise required                       | P1 open                  |
| Undo/redo, StrictMode, note switching                 | Existing tests; browser exercise required                             | P0 open                  |
| Composition in paragraphs and tables                  | Paragraph input rules still run during IME; table keys unguarded      | P0 open                  |
| Relative / malformed links                            | Root click resolves relative URLs and decodes unvalidated escapes     | P0 open                  |
| Cross-block selection, copy/cut/delete                | Whole-block policy; existing tests                                    | P1 open                  |
| HTML / Markdown / plain clipboard; URL over selection | Existing tests; browser exercise required                             | P1 open                  |
| Nesting, moving, duplication, drag                    | Existing subtree tests; browser exercise required                     | P1 open                  |
| Markdown typing rules                                 | Block and inline rules exist; audit composition and undo              | P1 open                  |
| Slash / wiki menus and inline toolbar                 | Existing tests; browser exercise required                             | P1 open                  |
| Tables, TSV paste, navigation                         | Existing tests; composition gap                                       | P1 open                  |
| Long documents, large tables, recursive toggles       | Existing model/serializer stress tests; audit runtime                 | P1 open                  |
| Empty-block placeholders, handles, turn-into menu     | Existing surfaces; browser exercise required                          | P1 open                  |
| Bare URL linkification                                | Missing since old editor                                              | P1 open                  |
| Preview grammar                                       | Colour/cut/checks/imsize loaded; files/tabs absent                    | P1 open                  |

Notion reference: [keyboard and Markdown shortcuts](https://www.notion.com/help/keyboard-shortcuts)
and [writing basics](https://www.notion.com/help/writing-and-editing-basics), checked 2026-10-16.
Use the interaction model where it fits plain Markdown; keep the app's documented shortcuts.

## Validation log

- Initial user changes saved as `/private/tmp/gravity-notes-initial.patch`; do not include them
  in unrelated commits. Colour swatches and the delayed-drag correction predate this session.
- Baseline: 52 test files, 1,159 tests pass; typecheck, lint, formatting and web build pass.
- Demo vault baseline: **0/65** notes fall back to source; audit reads only, stored in `/private/tmp/gravity-vault-before.json`.
- IME input/confirmation and table navigation: five new regression tests first failed, then passed
  after deferring DOM transforms during composition and retaining raw link destinations.

- YFM note/cut containers preserve their dialect, nested body and blank-line spelling; generated
  round-trip coverage includes both container kinds. Unsupported directives fail closed to source.

## Deferred work and human decisions

Pending the implementation and runtime audit. Each remaining item will receive an explicit
reason here before the session is complete.
