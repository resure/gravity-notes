# Architecture

How Gravity Notes is put together, what it writes to your disk, and where the edges are.

## Overview

```
FolderGate ──▶ NoteStore (filesystem | tauri-fs | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md on disk: web FSA / native Rust; or IndexedDB)  (state + autosave)   (UI)
```

The app ships two ways from one codebase: a **web app** and a **macOS desktop app** (Tauri 2).
Persistence sits behind one seam; the chrome keeps Gravity UI components with the Sol design.

## The storage seam

All persistence goes through the `NoteStore` interface
([`src/storage/types.ts`](../src/storage/types.ts)), with three backends:

- **`FileSystemNoteStore`** ([`src/storage/fileSystemStore.ts`](../src/storage/fileSystemStore.ts)) —
  plain `.md` files via the browser File System Access API (Chromium only).
- **`TauriNoteStore`** ([`src/storage/tauriStore.ts`](../src/storage/tauriStore.ts)) — the same
  `.md` folder through native Rust `fs` commands in the desktop app (the FSA API doesn't exist in
  WKWebView). No per-session permission re-grant.
- **`IndexedDbNoteStore`** ([`src/storage/indexedDbStore.ts`](../src/storage/indexedDbStore.ts)) —
  in-browser/in-app storage that works everywhere.

All three share the same note ids, canonical body shape, and `updatedAt`-based conflict semantics
([`src/storage/noteText.ts`](../src/storage/noteText.ts)), so everything above the seam — state,
search, navigation, UI — is backend-agnostic. Notes move between backends via `.md` zip
export/import ([`src/storage/transfer.ts`](../src/storage/transfer.ts)), which preserves folder
structure and attachment bytes both ways.

## What's on disk

A notes folder is meant to be shared with other tools — Obsidian, scripts, `grep`, iCloud. The
format, in full:

- **A note is a file.** Its id is its POSIX relative path (`Inbox.md`, `Work/Sub/Title.md`); the
  file name without `.md` is the title. Folders are real directories.
- **`.gravity-notes.json`** — one metadata sidecar at the root: sort mode, pins (notes and
  folders), created stamps, note icons, per-note appearance overrides, the open note, and the
  trash registry. Losing it loses pins and icons, never notes.
- **`.trash/`** — deleting a note moves it here (a hidden folder, excluded from listings), so
  Trash survives across app restarts and is restorable from the storage menu. Emptying the Trash
  is the only permanent delete.
- **`Attachments/`** — pasted/dropped files land here; notes reference them root-relatively. An
  image is written as one (`![…](Attachments/pie.png)`) and displayed inline; anything else is an
  ordinary link (`[report.pdf](Attachments/report.pdf)`), which `⌘-click` reveals in Finder and which
  other Markdown tools render as a working link. The stored Markdown never contains `blob:` URLs.
- **`.gnkeep`** — a marker file that keeps a deliberately-empty folder alive (Git-style).
- **Other files** (including extensionless files) appear as muted, non-editable rows alongside notes.
  Folder stores expose names and paths through optional `listFiles()` without reading file bodies;
  these entries have separate counts and never enter note search, editing, autosave, or export.
  Dotfiles (including dot-named `.md` files), dot-directories, write temporaries, `node_modules`,
  and the managed root `Attachments/` stay hidden. New note titles have leading dots removed so
  creating or renaming a note cannot hide it.
- **Folder deletion** accepts only empty folders or folders containing regular `.gnkeep` / `.DS_Store`
  files. Menu and keyboard deletion both ask for confirmation, with Cancel focused initially;
  housekeeping files are removed with the folder after confirmation. Other files, hidden contents, and subfolders block
  deletion. Both filesystem backends inspect contents before cleanup and delete non-recursively;
  an entry arriving during deletion is preserved. A failed deletion attempts to restore `.gnkeep`.
- **`[[Wiki links]]`** are stored verbatim — `[[Title]]` on disk, Obsidian-compatible round-trip.
  A leading slash makes the target exact from the notes root: `[[/Shared]]` names `Shared.md`,
  even when another folder contains a note with that title. An unresolved root path stays broken
  instead of falling back to a same-title note. Copied links use this spelling for ambiguous root
  notes; ordinary titles and `Folder/Note` targets retain their existing resolution rules.
  Following a missing `/path` creates the addressed note from the root. Paths that would be
  sanitized into a different name or enter a reserved directory report an error without writing.
- **Bare URLs** are written exactly as you type them. A CommonMark autolink (`<https://example.com>`)
  and `[text](url)` retain their spelling too. Bare `http(s)://` URLs are decorated as links in the
  editor without changing the stored text.
- **Blank lines** persist on disk as `&nbsp;` lines — the spelling this app has always used, since
  Markdown has no way to write an intentional blank ROW (a bare blank line is just block
  separation). They read back as empty blocks, and an empty block you type here is written the same
  way, so deliberate spacing survives a save in both directions. A table header row with every cell
  empty is written with `&nbsp;` in each cell for the same reason: GFM has no headerless table, so a
  truly empty header row is how a table WITHOUT a header is spelled.

## The Sol design on Gravity UI

[`src/tokens.css`](../src/tokens.css) defines the palette, type scale, radii, shadows and motion.
[`src/gravity.css`](../src/gravity.css) maps Gravity theme variables onto those tokens and supplies
component recipes for buttons, fields, menus, popups, dialogs, switches, segments and toasts.
Gravity UI still owns their behaviour; the Base UI layer from the experimental `sol-design`
branch is not used. App chrome uses the system font and the stroke icons in `src/icons/`; PT Serif
is bundled for the serif note-content option. `data-theme` on `<html>` follows light/dark/system,
and `data-accent` selects blue or gray (amber is the default).

The surfaces step from desk through the two panels to paper. Paper is the brightest surface in
light mode and the lightest dark surface in dark mode. Raised controls get lighter in dark mode,
while fields get darker with an inner shadow. Menu highlights stay neutral; accent marks focus,
selected segments, links, save state, text selection and the open note’s row.

The default pane widths are **236px folders / 324px notes / remaining editor**, with resizable
dividers. The **40px title bar** puts a left-panel toggle at the left, the search field centred on
the window and the orb beside it, and the open note’s `⋯` at the right. The desktop’s empty strip
drags the window; the native unified toolbar leaves traffic-light placement to macOS.

- The **orb** carries save state and app-wide actions: up to six recent workspaces inline,
  Open Folder…, Workspaces…, export/import, attachments, Trash, reload, panel toggles, theme,
  settings, shortcuts, updates and About. Desktop `⌘-click` on another workspace or Open Folder…
  opens a new window. The orb’s tooltip names the save state; errors and conflicts also appear in
  its menu.
- The **note’s `⋯` menu** (`⌘⇧I`) combines live font/width controls with preview, source mode,
  pin, rename, move, duplicate, reveal, copy wiki link and delete. It targets the open note even
  when search filters its row out. The list row’s menu targets that row instead. Copy link verifies
  that its output resolves to the same note, falling back to an exact root-relative filename when
  needed. A name the wiki syntax cannot represent reports an error without replacing the clipboard.
- The **note list** keeps a folder toggle, sort control and raised “New” button in its toolbar.
  Virtualized rows are **48px**, or **64px** when a third line shows the folder in All Notes or
  search. The title sits above the timestamp and preview; row actions appear at the title’s right
  edge on hover without moving the text. Pins lead the list. Trash is also available at the foot
  of the folder rail.

## Appearance settings

Settings commit live. Font and width resolve from the note outward; “Default” inherits the wider
scope. Accent is an app/workspace choice and stays the same while browsing notes.

| Scope     | Preferences                                                                            | Persistence                                            |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| App       | Editor font, text width, amber/blue/gray accent; toolbar, icons and spellcheck toggles | `gravity-notes:settings` in localStorage               |
| Workspace | Editor font, text width and accent, each with “Default”                                | `gravity-notes:<workspaceId>:settings` in localStorage |
| Note      | Editor font and text width, each with “Default”                                        | `appearances` in the metadata sidecar                  |

App and workspace settings merge changes into the latest stored value and adopt other windows’
`storage` events. Note overrides travel with the folder and follow rename/move and trash/restore.
Theme is a separate app-wide preference. “Show note icons” remains experimental: icons and emoji
are supported, with a file glyph for notes that have no custom icon.

## Workspaces & windows

Every opened folder/store is a **workspace**, remembered (with recency) in an IndexedDB registry
([`src/storage/workspaceRegistry.ts`](../src/storage/workspaceRegistry.ts)) that feeds the orb
menu’s inline workspace rows, the `⌃R` switcher, and launch restore. On the desktop each workspace can have
its own native window, plus Apple-Notes-style **per-note windows** (`⌘↵` on a list row) — small,
panels tucked away, focus-if-open, with `⌘0` bringing back the workspace's main window. The window
↔ workspace/note assignments live in the Rust shell, so new windows boot straight into the right
folder. Per-workspace UI layout — sidebar collapsed, rail open, selected folder, and the two
panel widths (`rail-width` / `sidebar-width`, from dragging the dividers) — lives under
workspace-namespaced localStorage keys; note windows neither read nor write those.

## Mobile & iOS

At ≤700px the layout collapses to a **single-pane push** model (`src/hooks/useIsNarrow.ts`,
`MOBILE_MAX_WIDTH`): the list and the editor each fill the body and exactly one shows at a time —
opening a note pushes to the editor pane, the Back button returns to the list. The folder rail
becomes a slide-over drawer with a dimmed backdrop. This applies on phones and on any desktop/iOS
window narrowed below the breakpoint; above it the multi-pane layout is unchanged. There is **no
CSS `@media`** for this breakpoint — the JS hook flips the `workspace__body_mobile` class and the
CSS reacts to that. From the editor pane, **swiping right goes back** to the list
(`src/hooks/useSwipeBack.ts`) — the touch counterpart of the top bar's Back button. It's an
_interactive_ gesture: the list tracks the finger and, on release, either completes or springs back
(past ~35% of the width, or on a fast flick). The swipe starts anywhere on the pane rather than in an
edge strip, so what keeps it from stealing real interactions is the DIRECTION of the movement — it's
claimed only once the drag is clearly horizontal and rightward, and a touch beginning inside a
horizontally-scrolled block (a wide table, a code fence) is left alone. Both outcomes animate off the
drag position with no timer, so a backgrounded tab (where timers are throttled) can't strand it.

The top bar is **one row that never swaps layouts**: orb · search in both panes, with a compact
icon-only Back leading it on the editor pane and the note’s ⋯ at the right edge. Keeping the search
mounted in both panes is what makes searching from inside a note work — a query typed there switches
to the list so the results are visible (and clearing it hands the note back), without the box ever
losing focus, since it is the same element throughout. The bar's geometry is _identical_ in the two
panes — same height, same orb position, same search width — because the pane-specific controls keep
their slots when they don't apply (`visibility: hidden`, not unmounted) instead of the layout being
recomputed around them. Height parity needs one more thing: the search is sized to match the Back
button, which otherwise made the header jump by 8px when a note opened.

Affordances are hidden by the thing they actually depend on, which is not always the width:
"Toggle sidebar" goes with the _layout_ (`mobile`, since a single pane has no sidebar to collapse),
while the keyboard-shortcuts sheet goes with the _input_ (`useHasHover`, since a narrow desktop
window still has a keyboard and would otherwise lose its only way in).

Touch input has two rules the whole UI depends on. Every `:hover` rule is wrapped in
`@media (hover: hover)`, because on a touch screen WebKit spends the first tap applying `:hover` and
**suppresses the click** when that reveals content (the note row's ⋯ button was doing exactly this,
so opening a note took two taps). And tap targets carry `touch-action: manipulation` (`index.css`)
so no tap waits on a possible double-tap-zoom. Keep new hover rules gated the same way.

The same codebase ships an **iOS app** (Tauri 2, a separate bundle id/identifier). The sandbox
blocks plain folder paths, so an iCloud Drive (or on-device) folder is opened through the native
Files picker in the in-tree [`icloud-fs`](../plugins/icloud-fs) plugin, which mints a
security-scoped **bookmark** persisted on the workspace entry. Access is held for the app's
lifetime, so the ordinary `TauriNoteStore` / `notes_*` commands read/write the folder as a normal
path; the per-note **and per-attachment** open/save go through a coordinated `NSFileCoordinator`
path in Swift ([`IcloudFsPlugin.swift`](../plugins/icloud-fs/ios/Sources/IcloudFsPlugin.swift)) that
materializes an evicted iCloud file before reading and writes atomically against a sync race (the
bulk list/corpus walks stay on the plain `notes_*` commands and skip evicted content). External note
links, which the desktop opens via a macOS-only `open` shell-out, route through the same plugin's
`open_url` (UIApplication) on iOS. The desktop multi-window affordances and the in-app updater are
iOS-absent.

## Live file-watching (desktop)

The desktop shell runs one debounced FSEvents watcher per open folder
(`notify` in [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)), shared by every window showing
it. External changes — another app, another window, a sync agent — push a `notes:changed` event;
the frontend re-checks the open note for conflicts and refreshes the list, which the search index
and backlinks follow automatically. Batches that name only a handful of notes are patched by
reading just those files' heads (skipping iCloud-dataless content, like the walk); a directory
path, a vanished known note, a bulk batch (>12 paths) or an empty "refresh everything" event
falls back to a full re-list. The app's own saves are recognized
and skipped, so typing never triggers refresh churn — an echo still schedules one deferred,
targeted read past the suppression window rather than a folder walk. With a live watcher the
focus handler only re-checks the open note's conflict; the full focus re-list remains for the
web/iOS backends (no watcher) and as the fallback when a subscription fails. Noise
(`.DS_Store`, the sidecar, `Attachments/`, temp files) is filtered at the source. On the web
there's no watching API, so external edits surface when the tab regains focus — or via **Reload
notes** in the storage menu.

## Search, backlinks & performance

Full-text ranking ([`src/search.ts`](../src/search.ts)) and wiki-link/backlink resolution
([`src/wikiLinks.ts`](../src/wikiLinks.ts)) are pure functions with no I/O — they score a shared
in-memory corpus loaded once by [`src/hooks/useCorpus.ts`](../src/hooks/useCorpus.ts) (one bulk
read, lazily, only while searching or a note is open). The corpus refreshes **incrementally** —
only notes whose mtime changed are re-read, and the just-saved open note is seeded from the
in-memory body instead of being read back — and the backlink graph is rebuilt only when a note's
links actually change, so a plain autosave costs nothing. Query debouncing keys on corpus SIZE
(bytes), not just note count, because scoring is linear in the text. The note list is virtualized
(`@tanstack/react-virtual`). There is deliberately **no inverted search index**: for
personal-vault sizes, scanning a pre-lowercased corpus is fast enough that an index would cost
more in build/invalidations than it saves.

Editing is decoupled from React state ([`src/hooks/useNotes.ts`](../src/hooks/useNotes.ts)):
keystrokes flow into a ref + a 500 ms autosave timer, so the editor instance is never re-created
mid-typing. Conflicts (a note changing underneath you) are detected by mtime and resolved through
a banner: reload / keep mine / save a copy / discard.

The block editor re-serializes the whole note on every keystroke, but `blocksToMarkdown` reuses
each unchanged block's lines (a `WeakMap` keyed by block, checked against a shallow snapshot), so
only the edited block is re-rendered to Markdown. A note of 200+ blocks also switches the editor to
a **long-note mode**: off-screen block bodies get `content-visibility: auto` (skipping their layout
and paint), drag handles are mounted only on the hovered/focused/selected block, and per-note
scroll is restored by block anchor rather than raw `scrollTop`, since skipped blocks are laid out
at estimated heights. WebKit has no CSS scroll anchoring, so there a `ResizeObserver` pays back
height changes above the viewport by hand (`scrollAnchoring.ts`). Opening a note parses it once:
the round-trip guard hands its blocks to the editor (`takeParsedBlocks`), and normalization keeps
unchanged blocks as the same objects, so the serializer's cache from the guard still applies. The
overlays that follow the caret share one `selectionchange` listener that runs once per frame
(`selectionFrame.ts`), and the first corpus load waits for idle time unless a search needs it.

## The desktop shell

[`src-tauri/`](../src-tauri) is a thin Tauri 2 shell: the `notes_*`/`attachment_*` filesystem
commands (deliberately dumb primitives — the note semantics live in TypeScript, mirroring the web
backend), the folder watcher, window management, native menu, and in-app **auto-update** via
GitHub Releases (signature-verified). Bulk listings skip iCloud **dataless** files' content so a
not-yet-downloaded vault doesn't block on the network; such notes list by name and fill in once
macOS materializes them.

## The editor

The note body is a **Notion-style block editor**, vendored into this repo and developed here: every
block is its own `contentEditable`, with a slash menu, drag-to-reorder, block selection, tables,
to-dos, images, and `[[wiki links]]`. It has no page chrome of its own — the pane above supplies the
title, the read-only preview, the Esc ladder, and the backlinks panel.

⌘⇧; swaps the blocks for the **raw Markdown** behind them, in CodeMirror (`SourceEditor.tsx`):
Markdown and fenced-code highlighting, find and replace, list continuation. It is loaded on first
use (warmed while idle), with a plain textarea (`SourceSurface.tsx`) standing in until it arrives,
and gives the app's global chords precedence over its own defaults. It is also where a note lands
when the block model can't hold it (see below), so it is a real editing surface rather than a viewer.
The ten most recently left notes keep eligible block-editor undo histories while the workspace
stays mounted. A snapshot is retained when its current Markdown is at most 256,000 characters and
resumes only when it matches the incoming content after trimming outer whitespace. Source undo
history is not retained across note switches.

A note becomes a document once per editing session: the editor parses the file into blocks at mount
and is remounted per note. The pane carries the per-note scroll and caret across a switch, so
returning to a note lands where you left it.

IME composition owns its live DOM until confirmation: paragraph Markdown shortcuts and table
navigation wait for composition to finish. Link opening passes the literal stored destination to
the URL policy, so a relative note link cannot turn into a browser URL for the app's own origin.
The compatibility audit and its validation log live in
[block-editor-parity.md](proposals/block-editor-parity.md).

Typing shortcuts retain an ordered list's starting number and support bold, italic, code,
strikethrough, mark and underline. Escaped delimiters stay literal. Pasting a multiline Markdown
document into an empty paragraph parses its first block as well as the rest. Replacing a text
selection across text blocks keeps the unselected head and tail, matching copy/cut/delete. A pasted
image or table cannot consume the text that followed the caret. Multiline syntax that the block
model cannot preserve is refused with a source-mode hint; it can be pasted into source instead.
Rich clipboard HTML goes through `htmlImport.ts`, which builds blocks, writes them to Markdown and
parses that back, so a paste is exactly what the note will reload as. It is used only when the HTML
carries structure or marks beyond its plain-text flavour; images become alt text or a link, and
colours and underline are dropped.

### Cross-block selections

The editor handles text selections across its separate editing hosts: copy/cut, typed characters,
Backspace/Delete, Enter and paste. It splits the selection’s ends and updates block state in one
operation, keeping unselected text. Shift-arrows extend the selection across block boundaries;
inline formatting chords are ignored while the selection spans blocks. A `beforeinput` guard also
covers insertion or deletion that arrives without a keydown, such as dictation or autocorrect.
An image/table endpoint, mixed code/text endpoints, or an ending toggle with hidden children uses
whole-block handling. A selection starting in a collapsed toggle’s summary keeps its hidden children.
Accepted plain, rich and internal-block pastes replace a text selection in one undo transaction,
keeping the retained head before the payload and the retained tail after it. Rejected or empty
clipboard content leaves the note unchanged. Internal text-block wiki chips are redecorated after
sanitizing; table cells retain their existing direct text editing.

WebKit clamps native selections to the host where they started. During cross-block extension the
editor temporarily makes its root editable, then restores focus to the block containing the
selection’s start. Chromium skips that workaround. WebKit selection painting uses the CSS Custom
Highlight `gn-cross-blocks`, with a repaint nudge when clearing it. These paths need WebKit/desktop
verification as well as DOM tests.

Read-only preview (⌘⇧P) is a different renderer — `@diplodoc/transform`, full CommonMark. That is
deliberate: the notes the block model can't hold are exactly the ones a preview most needs to get
right, so the preview must understand more Markdown than the editor does, not the same amount.

Preview works from source mode too, including notes forced to source by the round-trip guard,
and renders the current unsaved buffer. Its YFM plugins cover notes, cuts, tabs, file links,
multiline tables, definition lists and video. Inline marks share the block parser's matching rules.
File/tabs packages were already transitive dependencies of Diplodoc; they are declared directly
for their runtime/styles, with no new package versions introduced. Tabs include their interactive
runtime and remain usable after preview content changes.

### How blocks map to Markdown

`src/markdown/` converts between the two. Ordinary Markdown carries most of it — headings, lists,
task lists, quotes, fenced code, GFM tables — and the three block types Markdown cannot spell get a
portable encoding rather than a private one:

| Block   | On disk                                                            |
| ------- | ------------------------------------------------------------------ |
| toggle  | `<details>` + `<summary>` (collapsed state = the `open` attribute) |
| callout | an Obsidian `> [!note]` callout, which degrades to a quote         |
| image   | `![alt](Attachments/…)`, like every other attachment               |

YFM inline marks keep their spelling: `==mark==`, `++underline++`, `~sub~`, `^sup^`,
and `##monospace##`. Existing `<u>` underline remains `<u>`; YFM underline uses `<ins>` only
inside the editor DOM and writes back `++`. Literal runs that resemble these marks are escaped
when saved as plain text. Subscript and superscript currently support single words without spaces.

YFM notes (`{% note info "Title" %}` … `{% endnote %}`) and cuts (`{% cut "Title" %}` …
`{% endcut %}`) retain their dialect, title, kind, body spacing and nested blocks. Their title
is a callout/toggle row and their body is its indented subtree. Expanding a YFM cut is session-only:
YFM has no persisted open attribute. The note-kind picker offers only the four YFM kinds for these
notes. Newly inserted callouts still use Obsidian syntax and toggles use HTML details, preserving
the spelling used by previous block-editor versions. Existing files are not converted between
dialects. A heading's trailing `{#id}` anchors are kept verbatim as block metadata; unhandled YFM
directives and any other `{#…}` explicitly select source mode.

The round trip is meant to be a fixed point: opening a note and saving it unchanged must not rewrite
the file. Two rules protect that in the small — a `[[wiki link]]` is never escaped (it stays the
literal bytes Obsidian writes, which is also what the backlink scan reads), and a soft line break
inside a block is written as a plain newline rather than a backslash, so files don't sprout
punctuation on first save.

Intent isn't proof, so the editor **checks** instead of assuming. On load it parses the file into
blocks, writes those back out, and compares the result to the bytes it started from. If they differ
— the file holds something the block model can't reproduce — that note opens on its **raw Markdown**
instead, with a one-line notice saying so. You keep a fully editable surface, and because nothing
re-serializes the file, it is left exactly as it was.

That check is the safety property the whole mapping rests on, and it is what makes the parser's
incompleteness survivable. The block editor has no incremental edit model: every keystroke
re-serializes the _whole_ document, so the file it writes reflects what the parser understood, not
what you touched. Without the check, any construct it read imperfectly was rewritten across the
entire note the first time a single character changed anywhere in it. With it, a construct nobody
anticipated costs you the block surface for that one note rather than the note's contents.

The same reasoning shapes how a `[[wiki link]]` is styled. It gets a wrapper element whose text is
still the literal `[[Title]]` bytes. The brackets — and the `Note|` of a `[[Note|text]]` — are hidden
by CSS, never removed: the editor re-serializes from the live DOM, so a decoration that dropped them
would rewrite every link in the file to a bare title the first time any character changed anywhere
in it. The wrapper is one uneditable chip, so the caret can only sit beside it and no keystroke can
land inside the hidden part.
Bare `http(s)://` URLs get the same kind of wrapper, which is why they show as links in the editor
while the file keeps them bare. Code blocks are coloured without any wrapper at all: highlight.js
tokens are painted as CSS Custom Highlight ranges over the untouched text.

Editing a note in the block editor **does** rewrite the parts you touch into its own canonical form —
that is what any structured editor does, and it is why the mapping favours plain, widely-understood
Markdown over anything clever.

## Known limitations

- **A note rejected by the round-trip guard opens as raw Markdown.** Explicit structural checks
  cover YAML frontmatter, unhandled YFM directives, multiline YFM tables, definition lists, setext
  headings, reference definitions and heading ids. Source stays fully editable, with preview
  available. This is still a line parser, not a complete CommonMark model: other shapes, such as
  context-sensitive indented code and literal HTML, can remain literal when their spelling passes
  the guard. Full grammar support is deferred in the
  [parity audit](proposals/block-editor-parity.md). **Measured in this audit: 0 of 65 demo notes
  fall back before or after the changes.**
- **Structured nesting is limited to six levels.** Deeper files open in source because the editor's
  structural operations clamp depth; a parser-only fixed point would otherwise approve content
  that the mounted editor then flattens. The source remains fully editable.
- **Editing a note may normalise how its Markdown is spelled.** The check is no longer byte-exact:
  a note also passes when the only differences are spellings that mean the same thing — a redundant
  backslash escape (`\+` → `+`), `_emphasis_` → `*emphasis*`, cell padding, a run of blank lines.
  Those notes open in blocks, and the first edit rewrites the whole file in the canonical spelling,
  which will show up in a `git diff` even though nothing was said differently. A note is only
  accepted if that rewrite also SETTLES — a second save must produce the same bytes — so a file can
  never drift further on each edit. Structure, words and URLs are still compared verbatim: a
  heading level or a callout kind changing is a rejection, not a normalisation.
- **A note that is nothing but a blank row opens as source.** `&nbsp;` on its own line is this
  app's on-disk spelling for an intentional blank row, and it round-trips as one — but a note whose
  ENTIRE content is that one row reads back as an empty note, which is a different file, so the
  check above diverts it rather than rewrite it. Blank rows inside a note are unaffected.
- **Undo does not cross the blocks ↔ source switch.** Each surface keeps its own history.
- **A text selection with an image/table endpoint, mixed code/text endpoints, or an ending toggle
  hiding children acts on whole blocks.** Every block is its own `contentEditable`, but one browser selection extends right
  across them — and letting the browser delete half of one block and half of the next would edit DOM
  that React owns, behind its back, so the text came back on the next render. The editor therefore
  makes those edits itself: between two text blocks it keeps the head of the first and the tail of
  the last and joins them; where an end is not text, it takes each block the selection touches in
  full, the way `Esc` + `⇧↓` would.
- **A colour is the one thing this app writes that other Markdown tools can't read.** Colour has no
  portable spelling anywhere — Obsidian's own users reach for inline HTML — so notes carry the YFM
  colour extension's syntax instead: `{red}(text)` for ink, `{bg:yellow}(text)` for a background.
  Read-only preview renders it (it loads that extension), and so did this app's previous editor, so
  old coloured notes light up again. Obsidian and GitHub show the braces as text. Three edges follow
  from the spelling: a **block** colour is the same wrapper covering the block's whole content, so
  colouring every word of a block and colouring the block are the same bytes; a **code block, table,
  divider or image** has no inline text to wrap and so refuses a colour out loud; and content holding
  an **unbalanced `)`** closes the wrapper early — in the colour extension too, which is why the
  reader matches its rule — which shifts where the colour ends without changing a word of the text.
- **KaTeX is not rendered in the editor.** Code highlighting uses the language from the block’s
  picker and fence info string; unsupported languages remain plain. A table’s **header-column**
  flag has no Markdown spelling and is dropped on save; it still applies for the session, and
  says so in a toast when you use it.
- **Two windows on one store can clobber each other's _metadata_.** The sidecar (sort, pins,
  icons, per-note appearance) is last-write-wins everywhere: desktop windows coordinate their
  workspace assignments and note _bodies_ (the live watcher + conflict banner) through the shell,
  but not the sidecar — and browser tabs coordinate nothing, seeing external changes only on
  refocus. Body conflicts are detected by modification timestamp, coarse enough that rapid
  multi-window editing of the same note can miss or over-report changes.
- **In-browser storage is per-browser and per-origin.** It isn't synced across devices, and
  clearing the browser's site data erases it — use **Export** to keep a `.md` backup.
- **External changes are live only in the desktop app** (the folder watcher). In the browser and
  on iOS they're detected when you return focus to the window — or via **Reload notes** in the
  storage menu.
- **On iOS, only note and attachment _content_ is coordinated with iCloud**, not relocation:
  opening and saving go through `NSFileCoordinator`, but rename / move / trash / restore still use
  the plain `notes_rename` command. Relocating a note while iCloud is mid-sync can therefore lose
  the race and leave a conflict copy. Coordinating them means reimplementing that command's
  empty-ancestor pruning and no-clobber rename in Swift; done carelessly it strands ghost folders
  in the tree, which is why it hasn't been.
- **An evicted iCloud file can stall the iOS app for up to 15s.** Opening a note whose content
  iCloud has evicted starts the download and polls for it, and the metadata sidecar is read the
  same way during startup — so a fresh device restore, where everything is still a placeholder,
  can show a blank screen for ~15–30s. Wants an `NSMetadataQuery` observer and a bootstrap that
  reads whatever is local instead of blocking on the download.
- **A selected image shows a faint caret line** beside it in the editor — the browser's native
  object-selection caret, which resists CSS hiding. Cosmetic only.
- **Auto-update starts from the release that introduced it.** A build without the updater
  (≤ 0.2.0) has to be updated by hand once; from there the macOS app updates itself in place.
  Apple silicon (arm64) only.
