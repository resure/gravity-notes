# Sidebar Peek Shortcut (⌘⇧') + Drop the Toggle Highlight — Design

- **Date:** 2026-06-21
- **Status:** Approved (not yet implemented)
- **Sub-project:** Follow-up on the `remove-tabs-nvalt` branch, right after "Sidebar toggle + editor
  scroll". Adds a keyboard-triggered transient **peek** of the collapsed sidebar, and removes the
  top-bar toggle button's "selected" highlight.

## Context

The previous sub-project replaced the disliked mouse **hover-peek** overlay with a plain top-bar
toggle (`LayoutSideContent`, ⌘') and `display: none` when collapsed — deliberately deleting the
overlay/slide CSS. The user now wants the overlay presentation back, but **keyboard-driven and
collapsed-only**: ⌘⇧' slides the sidebar in over the editor so you can jump to another note, then it
gets out of the way. Separately, the toggle button's `selected` "on" highlight (added when fixing
`aria-pressed`) is unwanted — "it's already clear what it does."

Current state (relevant):

- `Workspace` owns `collapsed` (persisted in `localStorage['gravity-notes:sidebar-collapsed']`),
  renders `.workspace__body` with a `workspace__body_collapsed` modifier, and passes
  `collapsed`/`onToggleCollapsed` to `TopBar`. `.workspace__body_collapsed .workspace__sidebar
  { display: none; }` is the only collapsed rule; `.workspace__body` no longer has `position:
  relative`.
- The global shortcut layer is descriptor-driven: `SHORTCUTS` (`src/shortcuts.ts`) feeds both
  `useShortcuts` and the help dialog. `mod` combos fire regardless of focus, `preventDefault`, and
  match on `event.key.toLowerCase()`; a binding's `shift` flag requires (or forbids) Shift.
- `TopBar`'s toggle renders `<Button … selected={!collapsed}>` (Gravity derives `aria-pressed` from
  `selected`).
- `NoteList` already exposes `focusSelected()` (via `NoteListHandle`) and handles row Enter (commit),
  arrow/`j`/`k` browse, and Esc (`onEscapeList`).

Verified: `useShortcuts` matches `mod` bindings by `event.key`; Shift+apostrophe emits `"` (a distinct
character, not a case change), so a ⌘⇧' binding keyed on `"` with `shift: true` is unambiguous against
the existing ⌘' (keyed on `'`, no shift).

## Goal

Add a transient, keyboard-triggered **peek** of the collapsed sidebar (⌘⇧'), and remove the toggle
button's selected highlight — with no regression to the dock/collapse toggle, persistence, nav,
search, or the editor.

### Success criteria

- A third sidebar state, **peeked**, exists only while collapsed: the sidebar shows as an **overlay**
  slid in over the editor, and is focusable.
- **⌘⇧' peeks** the sidebar **only when it is collapsed** (no-op when docked) and moves keyboard focus
  into the note list (↑/↓ and ⌘J/⌘K work immediately).
- The peek **closes** (back to hidden) on **Esc** (focus → search), on **opening a note** (Enter on a
  row → commit; focus → editor), or on a **click outside the sidebar** (e.g. into the editor). Clicking
  a row *previews* it (keeps the peek open to keep browsing); only an explicit commit closes it.
- Docking the sidebar (⌘' or the top-bar button) while peeked **clears** the peek.
- The peek state is **not persisted** (a fresh session starts un-peeked).
- The top-bar toggle button **no longer shows a selected/highlight state**; it stays labeled and
  keyboard-reachable.

## Decisions (with rationale)

- **A non-persisted `peeked` boolean in `Workspace`, valid only while `collapsed`.** The collapse
  state is the persisted, structural one; the peek is ephemeral UI. Keeping it a separate transient
  flag (not in `localStorage`, not in the dotfile) means a reload never restores a half-open overlay.
  An effect enforces the invariant `!collapsed ⇒ !peeked`, so the three states (docked / hidden /
  peeked) never tangle.
- **⌘⇧' = a new `peekSidebar` action**, keyed on `"` with `shift: true` (because Shift+apostrophe is
  `"`). This both reads naturally as ⌘⇧' in the help dialog (`keys: "mod+shift+'"`) and is disjoint
  from ⌘' (which requires no shift). `useShortcuts` needs no logic change.
- **`peekSidebar` is a guarded open, not a toggle.** It sets `peeked=true` only when collapsed; the
  defined close triggers (Esc / open-note / click-outside) own dismissal. This matches the chosen
  "quick peek to jump" model and keeps each affordance single-purpose. (Re-pressing ⌘⇧' while peeked
  is a harmless no-op — it's already open and focused.)
- **`closePeek()` only flips `peeked=false`; each trigger owns focus.** Avoids a focus tug-of-war:
  opening a note lets the editor autofocus, Esc sends focus to search, a click lands focus wherever it
  clicked. A single function trying to "restore focus" would fight these.
- **Overlay via a `workspace__body_peeked` modifier, not `:hover`.** The collapsed sidebar becomes an
  absolutely-positioned, off-screen panel that the `_peeked` modifier slides in. Driving it by state
  (not hover) is what makes it keyboard-controllable. `visibility: hidden` in the hidden state keeps it
  out of the tab order and the a11y tree until peeked (the reason the prior sub-project preferred
  `display: none`); `_peeked` flips it to `visible`. This re-adds `position: relative` to
  `.workspace__body` (removed last sub-project) to anchor the overlay.
- **Slide animation included, tuned live.** A ~0.15s `transform` transition gives the "hovered" feel
  the user referenced. The exact `visibility` transition timing (and z-index/shadow) is confirmed in
  the browser; the documented fallback is plain `display: none` ↔ overlay with no slide if the timing
  fights ProseMirror or the a11y intent.
- **Remove `selected` from the toggle (request 1), accepting the `aria-pressed` loss.** The user wants
  no highlight; Gravity ties `aria-pressed` to `selected`, so dropping the highlight drops
  `aria-pressed`. A labeled action button (`aria-label`/`title`, focusable) is fine without it. The
  `aria-pressed` round-trip assertion added last sub-project is removed with it.
- **`NoteList` is unchanged.** The peek reuses its existing focus / commit / browse / Esc behavior —
  the peek is purely a `Workspace`-level presentation + focus concern.

## Detailed design

### State + wiring — `src/components/Workspace.tsx`

- Add `const [peeked, setPeeked] = useState(false);` and `const closePeek = useCallback(() =>
  setPeeked(false), []);`.
- **Invariant effect:** `useEffect(() => { if (!collapsed && peeked) setPeeked(false); },
  [collapsed, peeked]);` — docking always clears the peek.
- **Focus-on-open effect:** `useEffect(() => { if (peeked) listRef.current?.focusSelected(); },
  [peeked]);` — when the overlay opens, focus a row (the sidebar is now visible, so the row is
  focusable).
- **Click-outside effect (only while peeked):**

  ```tsx
  useEffect(() => {
      if (!peeked) return;
      const onDown = (event: MouseEvent) => {
          const target = event.target;
          if (target instanceof Node && !document.querySelector('.workspace__sidebar')?.contains(target)) {
              setPeeked(false);
          }
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
  }, [peeked]);
  ```

- **Shortcut:** add `peekSidebar: () => { if (collapsed) setPeeked(true); }` to the `useShortcuts({…})`
  call. (The closure reads the current `collapsed` because `useShortcuts` invokes the latest actions
  object via its ref.)
- **List commit closes the peek:** wrap the prop passed to `NoteList` —
  `onCommit={(id) => { nav.commit(id); setPeeked(false); }}`. (`setPeeked(false)` is a no-op when not
  peeked; the search box keeps `onCommit={nav.commit}`.)
- **List Esc closes the peek:** `onEscapeList={() => { setPeeked(false); nav.escapeToSearch(); }}`
  — closes the overlay (no-op if not peeked), then the normal escape-to-search lands focus in search.
- **Body className** gains the modifier:

  ```tsx
  className={
      'workspace__body' +
      (collapsed ? ' workspace__body_collapsed' : '') +
      (collapsed && peeked ? ' workspace__body_peeked' : '')
  }
  ```

Arrow-preview (`nav.browse`, ⌘J/⌘K) is intentionally left untouched, so browsing keeps the peek open;
only an explicit commit closes it.

### Shortcut descriptor — `src/shortcuts.ts`

- Extend `ShortcutAction` with `'peekSidebar'`.
- Add a descriptor (next to the `mod+'` toggle row):

  ```ts
  {
      keys: "mod+shift+'",
      description: 'Peek the collapsed sidebar',
      group: 'Navigation',
      global: {trigger: 'mod', key: '"', action: 'peekSidebar', shift: true},
  },
  ```

  `ShortcutActions` (a `Record`) then requires `Workspace` to supply `peekSidebar`. The help dialog
  lists the ⌘⇧' row automatically.

### Overlay CSS — `src/components/Workspace.css`

- Re-add `position: relative;` to `.workspace__body` (anchors the absolute overlay).
- Replace the single `display: none` collapsed rule with an off-screen overlay + a peeked slide-in:

  ```css
  /* Collapsed: the sidebar leaves the flow as an off-screen overlay so the editor fills the
     width. It stays mounted, but visibility:hidden keeps it out of the tab order until peeked. */
  .workspace__body_collapsed .workspace__sidebar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 5;
      transform: translateX(-100%);
      visibility: hidden;
      transition:
          transform 0.15s ease,
          visibility 0.15s ease;
      box-shadow: 0 0 16px rgba(0, 0, 0, 0.25);
  }

  /* Peeked (⌘⇧'): slide the overlay in and make it focusable. */
  .workspace__body_peeked .workspace__sidebar {
      transform: translateX(0);
      visibility: visible;
  }
  ```

  Exact z-index / shadow / `visibility` transition timing is tuned in the smoke test; fallback is
  `display: none` ↔ visible overlay with no slide.

### Drop the highlight — `src/components/TopBar.tsx`

- Remove `selected={!collapsed}` from the toggle `Button` and the comment clause that explained it
  (keep the "Toggle sidebar" label-wording note). The button keeps `aria-label`, `title`,
  `className="topbar__sidebar-toggle"`, and `onClick`.

## Testing

The editor is mocked in jsdom, but the peek state is a plain class + focus move, so the logic is
fully testable. The slide/shadow is visual-only (smoke test).

- **`useShortcuts`:** ⌘⇧' (`press({key: '"', metaKey: true, shiftKey: true})`) fires `peekSidebar`;
  it does **not** fire `toggleSidebar` (that requires no shift). `makeActions` gains
  `peekSidebar: vi.fn()`.
- **`Workspace` (integration), using a direct `keydown` for ⌘⇧' to avoid layout interpretation:**
  - When collapsed, ⌘⇧' adds `.workspace__body_peeked` and moves focus to a note row.
  - When docked (not collapsed), ⌘⇧' does nothing (no `_peeked`, no throw).
  - While peeked: **Esc** removes `_peeked`; **committing a note** (Enter on a row) removes `_peeked`;
    a **mousedown outside the sidebar** removes `_peeked`.
  - **⌘'** (or the top-bar button) while peeked clears `_peeked` (docks).
  - The peek does not persist: it isn't read from or written to `localStorage`.
- **`Workspace` (highlight removal):** the existing `aria-pressed` round-trip assertions are removed;
  the toggle still toggles `.workspace__body_collapsed` and persists the collapsed flag.
- **`ShortcutsDialog`:** the per-descriptor render test covers the new ⌘⇧' row automatically.

## Out of scope (YAGNI)

- Persisting the peek across reloads or remembering it per note.
- A resize handle / draggable sidebar width.
- Peeking while docked, or a non-keyboard way to peek (no edge strip, no hover).
- Animating the dock/undock toggle (only the peek overlay animates).

## Risks & mitigations

- **⌘⇧' on non-US layouts** may emit a different `event.key` than `"`. Mitigation: the user picked
  ⌘⇧' and will smoke-test; if their shifted-apostrophe differs, it's a one-character change to the
  binding `key`.
- **The slide + `visibility` transition can be finicky** (the hide direction may need a `visibility`
  delay). Mitigation: it's CSS-only, reversible, and smoke-tested; documented fallback is no-slide
  `display: none` ↔ overlay.
- **Click-outside + focus interactions.** A document `mousedown` listener could, in theory, race with
  the open keystroke — but the peek is opened by keyboard, so the first mousedown only ever closes it.
  Committing/Esc set `peeked=false` idempotently (no-op when already closed).
- **Re-adding `position: relative` / an overlay we just removed** reads as churn. Mitigation: the
  trigger is different (state-driven, keyboard-only, collapsed-gated), which is the whole point; the
  history (hover removed → keyboard peek added) reflects the actual design evolution.

## Implementation order

1. `shortcuts.ts`: `peekSidebar` action + `mod+shift+'` descriptor; `useShortcuts` test.
2. `Workspace`: `peeked` state, invariant + focus + click-outside effects, wire `peekSidebar`, wrap
   the list `onCommit`/`onEscapeList`, add the body modifier; Workspace peek tests.
3. `Workspace.css`: re-add `position: relative`; the off-screen overlay + `_peeked` slide-in.
4. `TopBar`: remove `selected` (+ the aria-pressed test); trim the comment.
5. Full test/lint/build; manual Chromium smoke (peek slide, the three close triggers, no highlight).
   Update `CLAUDE.md` roadmap.
