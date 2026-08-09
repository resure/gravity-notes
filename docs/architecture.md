# Architecture

How Gravity Notes is put together, what it writes to your disk, and where the edges are.

## Overview

```
FolderGate ──▶ NoteStore (filesystem | tauri-fs | indexeddb) ──▶ useNotes() ──▶ NoteList + EditorPane
(choose storage)  (.md on disk: web FSA / native Rust; or IndexedDB)  (state + autosave)   (UI)
```

The app ships two ways from one codebase: a **web app** and a **macOS desktop app** (Tauri 2).
Everything interesting sits behind one seam.

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
- **`Attachments/`** — pasted/dropped images land here as files; notes reference them
  root-relatively (`![…](Attachments/pie.png)`). The stored Markdown never contains `blob:` URLs.
- **`.gnkeep`** — a marker file that keeps a deliberately-empty folder alive (Git-style).
- **`[[Wiki links]]`** are stored verbatim — `[[Title]]` on disk, Obsidian-compatible round-trip.
- **Bare URLs** you type are linkified in the editor and normalized to `<url>` on save; a stray
  `Notes.md` never turns into a link (fuzzy linkify is off — `.md` is a real TLD).
- **Blank lines** inside a note persist as `&nbsp;` lines (the editor's `preserveEmptyRows`), so
  intentional vertical space survives the Markdown round-trip.

## Workspaces & windows

Every opened folder/store is a **workspace**, remembered (with recency) in an IndexedDB registry
([`src/storage/workspaceRegistry.ts`](../src/storage/workspaceRegistry.ts)) that feeds the orb
menu's Open Recent, the `⌃R` switcher, and launch restore. On the desktop each workspace can have
its own native window, plus Apple-Notes-style **per-note windows** (`⌘↵` on a list row) — small,
panels tucked away, focus-if-open, with `⌘0` bringing back the workspace's main window. The window
↔ workspace/note assignments live in the Rust shell, so new windows boot straight into the right
folder.

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
icon-only Back leading it on the editor pane and the note's ⋯ at the right edge. Keeping the search
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
and backlinks follow automatically. The app's own saves are recognized and skipped, so typing
never triggers refresh churn. Noise (`.DS_Store`, the sidecar, `Attachments/`, temp files) is
filtered at the source. On the web there's no watching API, so external edits surface when the tab
regains focus — or via **Reload notes** in the storage menu.

## Search, backlinks & performance

Full-text ranking ([`src/search.ts`](../src/search.ts)) and wiki-link/backlink resolution
([`src/wikiLinks.ts`](../src/wikiLinks.ts)) are pure functions with no I/O — they score a shared
in-memory corpus loaded once by [`src/hooks/useCorpus.ts`](../src/hooks/useCorpus.ts) (one bulk
read, lazily, only while searching or a note is open). The corpus refreshes **incrementally** —
only notes whose mtime changed are re-read — and the backlink graph is rebuilt only when a note's
links actually change, so a plain autosave costs nothing. The note list is virtualized
(`@tanstack/react-virtual`). There is deliberately **no inverted search index**: for
personal-vault sizes, scanning a pre-lowercased corpus is fast enough that an index would cost
more in build/invalidations than it saves.

Editing is decoupled from React state ([`src/hooks/useNotes.ts`](../src/hooks/useNotes.ts)):
keystrokes flow into a ref + a 500 ms autosave timer, so the editor instance is never re-created
mid-typing. Conflicts (a note changing underneath you) are detected by mtime and resolved through
a banner: reload / keep mine / save a copy / discard.

## The desktop shell

[`src-tauri/`](../src-tauri) is a thin Tauri 2 shell: the `notes_*`/`attachment_*` filesystem
commands (deliberately dumb primitives — the note semantics live in TypeScript, mirroring the web
backend), the folder watcher, window management, native menu, and in-app **auto-update** via
GitHub Releases (signature-verified). Bulk listings skip iCloud **dataless** files' content so a
not-yet-downloaded vault doesn't block on the network; such notes list by name and fill in once
macOS materializes them.

## Two editors

The note body can be edited by either of two surfaces (**Settings › Editor**); both read and write
the same `.md` files, so switching is safe at any time.

- **Markdown** (default) — `@gravity-ui/markdown-editor`: WYSIWYG plus a raw Markup mode (⌘⇧;), the
  `[[` link picker and link tooltips, KaTeX, syntax highlighting, and the attachment image NodeView.
- **Blocks** — a Notion-style block editor (vendored into this repo, and developed here): every
  block is its own `contentEditable`, with a slash menu, drag-to-reorder, block selection, tables,
  and to-dos. Its own page chrome was removed — the pane supplies the title, icon, and save state.

They plug into the same pane behind one imperative contract, so the title, icon, read-only preview,
Esc ladder, and backlinks are shared. What differs is how a note becomes a document: the Markdown
editor is a long-lived instance whose content is swapped on a note switch (it saves and restores
scroll itself), while the block editor parses Markdown into blocks once per session and remounts.

### How blocks map to Markdown

`src/markdown/` converts between the two. Ordinary Markdown carries most of it — headings, lists,
task lists, quotes, fenced code, GFM tables — and the three block types Markdown cannot spell get a
portable encoding rather than a private one:

| Block   | On disk                                                            |
| ------- | ------------------------------------------------------------------ |
| toggle  | `<details>` + `<summary>` (collapsed state = the `open` attribute) |
| callout | an Obsidian `> [!note]` callout, which degrades to a quote         |
| image   | `![alt](Attachments/…)`, like every other attachment               |

The round trip is meant to be a fixed point: opening a note and saving it unchanged must not rewrite
the file. Two rules protect that in the small — a `[[wiki link]]` is never escaped (it stays the
literal bytes Obsidian writes, which is also what the backlink scan reads), and a soft line break
inside a block is written as a plain newline rather than a backslash, so files don't sprout
punctuation on first save.

Intent isn't proof, so the block editor **checks** instead of assuming. On load it parses the file
into blocks, writes those back out, and compares the result to the bytes it started from. If they
differ — the file holds something the block model can't reproduce — that note opens in the
**Markdown** editor instead, even with Blocks selected. You keep a fully editable surface and the
file is left exactly as it was.

That check is the safety property the whole mapping rests on, and it is what makes the parser's
incompleteness survivable. The block editor has no incremental edit model: every keystroke
re-serializes the _whole_ document, so the file it writes reflects what the parser understood, not
what you touched. Without the check, any construct it read imperfectly was rewritten across the
entire note the first time a single character changed anywhere in it. With it, a construct nobody
anticipated costs you the block surface for that one note rather than the note's contents.

Editing a note in the block editor **does** rewrite the parts you touch into its own canonical form —
that is what any structured editor does, and it is why the mapping favours plain, widely-understood
Markdown over anything clever.

## Known limitations

- **The block editor is not feature-equal with the Markdown one.** Choosing **Blocks** in Settings
  gives up the `[[` autocomplete picker and link tooltips, KaTeX, and code syntax highlighting
  (⌘-click and ⌘↵ still follow a `[[wiki link]]`). Its raw-Markdown mode (⌘⇧;, same shortcut as the
  other engine) is a plain textarea rather than a CodeMirror surface, so it has no highlighting or
  Markdown-aware editing of its own. Two of its own features have no Markdown spelling and are
  dropped when it saves: block **colors** and a table's **header-column** flag.
- **A note Blocks can't represent opens in Markdown instead.** The block model is smaller than
  Markdown — headings stop at H3, a fenced code block has nowhere to keep its language, a callout
  has nowhere to keep its kind, a table has nowhere to keep column alignment, and YAML frontmatter
  isn't a block at all — and the parser is line-oriented rather than full CommonMark. Any file
  holding such a construct fails the load-time check and simply opens in the Markdown editor. The
  price is the occasional note Blocks won't take, which is also why Markdown stays the default:
  Blocks is an alternative surface, not a replacement.
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
