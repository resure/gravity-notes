# Handoff: Notes — GravityUI → Base UI redesign (v2)

## Overview
A full visual + component redesign of Gravity Notes: a three-pane desktop notes app (Tauri + React) and its iOS counterpart, migrating all chrome from GravityUI to **@base-ui/react 1.7** while keeping the ProseMirror-class block editor. The design direction: quiet, warm, paper-first — Things-level craft with Notion-class editing. This is **v2**, revised after a design review; all decisions below are final.

## About the Design Files
The files in this bundle are **design references created in HTML** — they show intended look and behavior, and are not production code to copy. The task is to **recreate these designs inside the existing `gravity-notes` codebase** (React 18 + TypeScript + Vite + Tauri, notes as markdown files on disk, folders as real directories) using its established patterns, replacing GravityUI components with Base UI per the mapping in the spec's §11.

The primary reference is **`Notes - Base UI Handoff.dc.html`** — a complete, sectioned specification with every screen rendered at true pixel size (open it in a browser; `support.js` must sit beside it). This README summarizes it; the spec is the source of truth for anything not covered here. Screen-map numbers in §04 annotate the shell mock.

## Fidelity
**High-fidelity.** Every mock is rendered at 1:1 with final colors, type, spacing and copy. Recreate pixel-perfectly. Two bundled micro-mocks record review decisions: `Title Voice B - Serif.dc.html` (chosen title treatment) and `Scope Header A - Quiet.dc.html` (chosen list header).

## Locked decisions from review (v2)
- **One accent: amber.** No accent picker anywhere. Blue/gray are gone.
- **Selection is neutral**, not accent-tinted, in both themes and on iOS.
- **PT Serif** (bundled webfont, regular 400 + italic, Cyrillic-complete) for note titles, section headings, and the editor's serif body option. Everything else is system SF. Never load it from a CDN in the app.
- **Cyrillic is a primary content language** — verify every text surface with RU strings (mocks carry mixed RU/EN).
- **Dark is ink**, not gray-brown (values below).
- **Appearance inheritance has two levels**: app default → per-note. The workspace level is cut.
- **Note icons feature is cut** (no Settings row, no 15px row reservation).
- **Focus mode hides the two panes only**; title bar and search stay.
- **Note list gets a scope header**: folder name + count; per-row breadcrumbs are gone.

## Screens / Views (spec section in parentheses)
1. **Desktop shell, light (§04)** — 1280×800 frameless window. Panes: folder tree 236px (`--bg-panel`), note list 324px (`--bg-panel-2`), editor fill (`--bg-paper`). Title bar 44px: traffic lights inset 18px, amber Orb (app menu, 8px disc in 26px target) left of a 404×27px centered "Search or create" field, sync dot + word right. Tree rows 32px, one 18px inset, 12px indent steps, counts right-aligned tabular. List: 38px scope header ("Alpha · 86" at 14/600 + count, quiet "Updated ⌄" sort text-button, raised 24px "+ New" — the only raised control), time-group labels (Pinned/Today/Yesterday/Earlier, 9.5px mono uppercase), 58px fixed virtualized rows.
2. **Desktop shell, dark (§04b)** — identical geometry, inverted stack: desk 0.15 → panel 0.19 → panel-2 0.21 → paper 0.235 (paper is the *lightest*). Hairlines white/9%, raised controls get 6% top highlight, inputs go darker-with-inner-shadow while raised controls go lighter.
3. **Note row, all states (§05)** — 58px fixed: title 14/19 (500 rest, 600 selected), preview 12.5/17 one line (body text, first ~70 chars, no markup), time 12/16 tabular. 20px pane inset, 8px-inset rounded hit area, radius 8. States: rest / hover (neutral 4% wash + 24px ⋯ target) / selected list-focused (neutral 6.5% light, 8% white dark) / selected focus-elsewhere (darker step) / rename-in-place (no field chrome, amber text selection) / search hit (match highlight) / skeleton. Hover suppressed adjacent to selection.
4. **Editor & affordances (§06)** — measure 680px centered; body 15/24; title PT Serif 28/34/400; H2 PT Serif 20/27/400. Block gutter (⋮⋮ drag + insert, both hidden at rest, tooltip after 420ms), hovered-block wash 2.8% with 6px bleed, format bar anchored above selection, slash menu at caret, wiki-link picker on `[[` (Combobox), wiki links render amber (never browser-blue). Note-appearance popover (⌘⇧I): Font Default/Sans/Serif/Mono + Width Default/Narrow/Wide/Unlimited, "Default" = inherit app setting.
5. **Menus & popovers (§07)** — one material: 12px radius, 1px `--line`, `--shadow-3`, 6px padding, 32px rows, 16px icon column, 13.5px labels, shortcut hints in `--text-4`, inset divider before the single destructive item. Highlights are **neutral** (transient state). Note row menu = right-click ContextMenu at cursor. Orb menu = app-wide commands + workspace list. Sort Select: check column reserved, no field chrome until hover. Tooltips 26px, 420ms delay, 0ms for neighbors.
6. **Settings (§08)** — 620px dialog, two sections (General / Appearance), 150px label column, 22% scrim, live-commit (no Save/Apply). Rows: Show editor toolbar (Switch), Editor Markdown/Blocks (EXP chip), Editor font, Text width (Narrow/Default/Wide/Unlimited). All segmented controls are Base UI Toggle Group.
7. **Empty / loading / error states (§09)** — six states, each drawn in its own pane, never full-window; no illustrations, at most one oversized quiet glyph (44px, `--text-4`-adjacent). Skeleton rows, no spinner under 400ms. Sync-conflict banner: one layout, three tones, not dismissible on its own. First-run folder gate has the app's only filled button.
8. **iOS (§10)** — 402×874. Same tokens; rows 66px, targets ≥44px, 52px floating compose button, three stacked screens (Folders → List → Note) with swipe-back, block toolbar pinned above keyboard (44px targets, 19px icons), long-press lifts block 2° with shadow. Accent = bare tappable word only — never a fill, never a whole row.

## Interactions & Behavior
- **Search field**: type → ranked full-text; top match autocompletes inline; Tab accepts; ⏎ opens top match or creates note with that title; Esc clears then closes.
- **Motion tokens**: `--dur-0` 0ms (selection, caret — selection never animates), `--dur-1` 110ms (hover/press), `--dur-2` 170ms (popup in; out in half), `--dur-3` 240ms (pane collapse), `--ease: cubic-bezier(.2,.8,.2,1)`, `--ease-in: cubic-bezier(.4,0,1,1)`. Popups scale from 0.97, transform-origin at trigger.
- **Three signature moments (only these move for effect)**: note switch = paper crossfade + 2px rise (`--dur-2`); block drag = 2° tilt under `--shadow-3` (desktop and iOS); pane collapse = `--dur-3` with a hair of overshoot.
- **Focus ring**: 2px accent at 100%, 2px offset, `:focus-visible` only, never suppressed.
- **Keyboard**: full map in §12 — reproduce exactly (⌘N new note, ⌘K/⌘⌥K insert link, `[[` wiki picker, F2 rename, ⌘⇧M move, ⌘D duplicate, ⌘⌫ trash, ⌘L jump to search, ⌘\ / ⌘⌥\ sidebars, ^R workspace, ⌘/ shortcuts sheet, ⌘, settings, etc.).
- **Chrome arrives on demand**: drag handles, insert buttons, row overflow, folder actions all invisible until pointer/keyboard focus is in range.

## State Management
- Notes are markdown files on disk; folders are directories; no server, no multi-user. List virtualized at thousands of rows → 58px fixed height is a hard requirement.
- Appearance state: app default + optional per-note override (font, width); "Default" segment = inherit. Theme: `data-theme` on `<html>` + one media query for System — **no ThemeProvider, no data-accent**.
- Sync status (saved / writing / offline / failed) drives the title-bar dot: amber / dim amber / gray / red. Save toasts are gone; Toast only for genuine failures.
- Editor stays ProseMirror-based; Base UI supplies chrome around it (gutter, bars, popovers), never the editing surface.

## Design Tokens (`tokens.css`, ship before any component work)
Light: `--bg-desk` oklch(0.94 0.008 75) · `--bg-panel` 0.968 0.006 75 · `--bg-panel-2` 0.982 0.004 75 · `--bg-paper` 1 0 0 · `--text-1..4` 0.24/0.45/0.62/0.74 (chroma ~0.014, hue 75) · `--line` rgba(62,54,42,.08) · `--bg-hover` …/.04 · `--bg-selected` …/.065.
Dark: `--bg-desk` oklch(0.15 0.006 75) · `--bg-panel` 0.19 0.007 75 · `--bg-panel-2` 0.21 0.007 75 · `--bg-paper` 0.235 0.008 75 · `--text-1..4` 0.94/0.72/0.58/0.46 · `--line` rgba(255,255,255,.09) · `--bg-hover` …/.05 · `--bg-selected` …/.08.
Accent (fixed): light oklch(0.70 0.14 62), dark oklch(0.78 0.13 68), `--accent-soft` accent/0.14. Permitted uses on desktop — focus ring, active toggle segment, hyperlink, sync dot, text selection; iOS adds bare tappable words. Danger oklch(0.58 0.20 26) (not an accent).
Type: label 9.5/14 mono 0.13em caps · meta 11/14 · ui-sm 12/16 · time 12/16 tabular · preview 12.5/17 · menu 13.5/18 · ui 14/19 (500/600) · body 15/24 · h2 PT Serif 20/27/400 · h1 PT Serif 28/34/400. UI weights 400/500/600 only; ≥13.5px carries letter-spacing −0.003em; dates/counts tabular-nums.
Radius: 4 chips · 6 buttons/fields · 8 menus/rows · 12 dialogs · 16 iOS sheets.
Shadows: `--shadow-1` 0 1px 2px rgba(52,44,32,.05) · `--shadow-2` 0 2px 6px −1px …/.10 + 0 1px 2px …/.06 · `--shadow-3` 0 12px 32px −8px …/.18 + 0 2px 6px −1px …/.10 + inset 0 1px 0 rgba(255,255,255,.9) · `--shadow-4` 0 32px 64px −16px …/.28 + 0 8px 20px −8px …/.16 + same inset. Dark: inset highlight → rgba(255,255,255,.06), shadow alphas deepen to ~0.5. Every floating surface carries the inset top highlight.
Hairline rule: 1px lines only where a group ends (above Trash, between menu sections) — never between rows (exception: iOS inset grouped lists).

## Component migration (full table in §11)
Menu+ContextMenu ← DropdownMenu · Dialog/AlertDialog ← Dialog · Popover ← Popup · Select ← Select · Switch ← Switch · Toggle Group ← SegmentedRadioGroup · Input+Field ← TextInput · Combobox ← List (wiki-link suggest) · Toast ← useToaster · Progress ← Progress. Own code: Button (quiet/raised/filled — filled used exactly once, folder gate), icon set (one stroke each; boxes 12/15/16/19 per context; B/I/S/H1/H2/&lt;&gt; are letterforms not icons), Label chip, kbd, banner, skeleton. Delete: Text, Card, ThemeProvider/MobileProvider. `@gravity-ui/markdown-editor` stays. Portal to `document.body`, `isolation: isolate` on the root.

## Build order (§13 — six shippable passes)
1 tokens.css → 2 primitives → 3 shell (the pass people judge) → 4 editor chrome (highest regression risk — lean on editor tests) → 5 dialogs & states (last GravityUI import removed) → 6 iOS. One open item: Windows title-bar layout (search can't stay window-centered) — decide before the Windows build, does not block macOS.

## Assets
- `assets/gravity-notes-light.png`, `assets/gravity-notes-dark.png` — screenshots of the **current** app, for before/after context only.
- PT Serif: obtain 400 + 400-italic (latin + cyrillic subsets) and bundle in `src/fonts/` alongside existing fonts; @font-face locally. 700 optional (unused by the display role).
- No other imagery; icons are drawn per §11 rules.

## Files
- `Notes - Base UI Handoff.dc.html` — the full spec (open in a browser; keep `support.js` beside it)
- `support.js` — runtime the spec page needs
- `Title Voice B - Serif.dc.html` — decision record: chosen title treatment
- `Scope Header A - Quiet.dc.html` — decision record: chosen list header
- `assets/` — current-app screenshots
