# `SelectionContext` selection toolbar goes permanently dead after an `EditorState` swap

Package: `@gravity-ui/markdown-editor`, WYSIWYG mode. Observed in **15.41.0** (current at the
time of writing). Affected code: `src/extensions/behavior/SelectionContext/index.ts`
(`build/esm/extensions/behavior/SelectionContext/index.js` in the published package).

## Summary

`SelectionTooltip` keeps two mutable flags on the extension instance — `destroyed` and
`_isMousePressed` — and nothing re-arms them when its plugin view is re-created. ProseMirror
re-creates every plugin view whenever `state.plugins` changes identity, and `EditorState.create`
always builds a fresh plugins array (prosemirror-state's `Configuration` copies it) — so any
host-side state swap triggers this, even one that passes `view.state.plugins` through unchanged.
After one swap, the toolbar dies on the next click:

1. The swap destroys the plugin views → `destroy()` sets `destroyed = true`. The view is
   re-created immediately, but `view()` never resets the flag.
2. The next mousedown hides the tooltip, sets `_isMousePressed = true`, and arms a one-shot
   document `mouseup` listener.
3. That listener starts with `if (this.destroyed) return` — so `_isMousePressed` is never reset.
4. Every later `update()` exits at `if (this._isMousePressed) return`. The toolbar never appears
   again for the lifetime of the editor — no errors, nothing in the console.

Needing a prior swap makes the bug look intermittent (for us: "works in dev, broken in the
packaged app" — the real variable was whether a swap had happened before the user selected text).

## Minimal reproduction

Any WYSIWYG editor with a non-empty `selectionContext` config:

```ts
// 1. Select text with the mouse → the floating toolbar appears. Fine.
// 2. Swap the state once, e.g. a host-side undo-history reset:
view.updateState(EditorState.create({doc: view.state.doc, plugins: view.state.plugins}));
// 3. Click once anywhere in the editor.
// 4. Select any text, with mouse or keyboard → the toolbar never appears again.
```

## The shipped code, annotated

`build/esm/extensions/behavior/SelectionContext/index.js`:

```js
class SelectionTooltip {
  destroyed = false; // set true in destroy(), never reset
  // ...
  _isMousePressed = false; // set on mousedown; only reset in the (guarded) mouseup
  // ... constructor, get key() ...

  get props() {
    return {
      // ... handleKeyDown (Escape) ...
      handleDOMEvents: {
        mousedown: (view) => {
          const startState = {
            doc: view.state.doc,
            selection: view.state.selection,
          };
          this._isMousePressed = true;
          this.cancelTooltipHiding();
          this.tooltip.hide(view);
          const onMouseUp = () => {
            if (this.destroyed) return; // ← [1] leaks _isMousePressed === true
            this._isMousePressed = false;
            this.update(view, startState); // ← [2] stale snapshot, see below
          };
          document.addEventListener('mouseup', onMouseUp, {once: true});
        },
      },
    };
  }

  view(view) {
    this.update(view); // ← [1] no re-arm of the two flags
    return {
      update: this.update.bind(this),
      destroy: () => {
        this.destroyed = true; // ← [1] sticks across re-creation
        // ...
      },
    };
  }

  update(view, prevState) {
    this.editorView = view;
    if (this._isMousePressed) return; // ← [1] everything dies here afterwards
    // ...
    const {state} = view;
    if (prevState && prevState.doc.eq(state.doc) && prevState.selection.eq(state.selection)) {
      return; // ← [2] "unchanged since mousedown" gate
    }
    // ...
  }
}
```

**[1] is the permanent death** described above.

**[2] is a second, related flaw:** even with healthy flags, the mouseup re-check passes the state
snapshotted at mousedown, and `update()` skips when doc + selection are unchanged since then. But
the mousedown just hid the tooltip — so a press-release cycle that keeps the selection strands
the toolbar hidden over a live selection. Example: right-click an existing selection on a
platform that delivers the mouseup before opening the context menu — the selection is kept, the
snapshot matches, and the toolbar stays hidden after the menu closes.

## Suggested fix

Re-arm the flags in `view()` (plugin views are re-created far more often than plugins are), and
re-check without the snapshot on mouseup ("unchanged" must not mean "keep hidden" — the mousedown
just hid it):

```js
view(view) {
    this.destroyed = false;
    this._isMousePressed = false;
    this.update(view);
    // ...
}

const onMouseUp = () => {
    if (this.destroyed) return;
    this._isMousePressed = false;
    this.update(view); // no startState
};
```

Related hardening while in this handler: some presses never deliver a document `mouseup` at all —
a right-click on macOS (the native context menu opens during mousedown and swallows the release),
or a press that turns into a native drag (ends with `dragend`) — wedging `_isMousePressed` until
the next completed left click. Arming the gate only when `event.button === 0` (still hiding on
other buttons) plus resetting the flag on `dragstart` closes that too.

We ship a vendored copy with these fixes (`src/components/editor/selectionContextFix.ts` in
[gravity-notes](https://github.com/resure/gravity-notes)) and verified the before/after behavior
end-to-end in a packaged app with the plugin's gate decisions instrumented: before —
`mousedown → mouseup → (nothing)`, toolbar dead; after — `mousedown → mouseup → SHOW`.

## Environment

- `@gravity-ui/markdown-editor` 15.41.0, WYSIWYG mode, `full` preset
- React 18, ProseMirror as bundled
- Reproduced on macOS (WKWebView / Tauri 2 shell); the mechanism is engine-independent — the
  trigger is plugin-view re-creation, not the browser
