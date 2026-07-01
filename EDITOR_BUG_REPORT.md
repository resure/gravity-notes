# Bug report: `SelectionContext` selection toolbar permanently stops appearing after plugin views are recreated

Upstream: `@gravity-ui/markdown-editor` (WYSIWYG mode).
Observed in: **15.41.0** (current at the time of writing). The affected code is
`src/extensions/behavior/SelectionContext/index.ts` (in the published package:
`build/esm/extensions/behavior/SelectionContext/index.js`).

## Summary

The `SelectionTooltip` plugin keeps two pieces of mutable state on the **extension instance**
(`destroyed`, `_isMousePressed`) but only ever _sets_ them — it never re-arms them when its plugin
view is re-created. ProseMirror destroys and re-creates **all** plugin views whenever the
`EditorState`'s `plugins` array changes identity (e.g. the host app calls
`view.updateState(EditorState.create({doc, plugins: view.state.plugins}))` — note that even passing
the _same_ plugins array produces a new `state.plugins` identity, because `EditorState.create`
rebuilds its configuration). After one such cycle the selection toolbar is permanently dead:

1. Plugin view is destroyed → `destroy()` sets `this.destroyed = true`. The plugin view is
   immediately re-created (`view()` runs again), but nothing resets `destroyed`.
2. User presses the mouse in the editor → the `mousedown` handler hides the tooltip, sets
   `this._isMousePressed = true`, and arms a one-shot document `mouseup` listener.
3. The `mouseup` listener starts with `if (this.destroyed) return;` — so it exits **without ever
   resetting `_isMousePressed`**.
4. From now on every `update()` call returns immediately at `if (this._isMousePressed) return;`.
   The toolbar never appears again for the lifetime of the editor — no errors, nothing in the
   console.

Because step 1 requires a state swap first, the bug looks intermittent/environment-dependent
(it bit us as "works in dev, broken in the packaged production app" — the actual variable was
whether the host had already swapped state before the user selected text).

## Minimal reproduction

```ts
// 1. Create a WYSIWYG editor with a selectionContext config (any preset with the selection
//    toolbar enabled). Select some text with the mouse → the floating toolbar appears. Fine.

// 2. Swap the state once, preserving doc and plugins — e.g. a host-side undo-history reset:
view.updateState(EditorState.create({doc: view.state.doc, plugins: view.state.plugins}));
// prosemirror-view: state.plugins identity changed → destroyPluginViews() + updatePluginViews().
// SelectionTooltip.destroy() ran → this.destroyed === true, and view() did not reset it.

// 3. Click once anywhere in the editor (mousedown hides the tooltip, mouseup is ignored because
//    destroyed === true, so _isMousePressed stays true).

// 4. Select any text, by mouse or keyboard → the toolbar never appears again.
```

## Root cause, in the shipped code

`build/esm/extensions/behavior/SelectionContext/index.js`:

```js
class SelectionTooltip {
    destroyed = false;          // set true in destroy(), never reset
    _isMousePressed = false;    // set true on mousedown; only reset in the (guarded) mouseup

    get props() {
        return {
            handleDOMEvents: {
                mousedown: (view) => {
                    this._isMousePressed = true;
                    this.cancelTooltipHiding();
                    this.tooltip.hide(view);
                    const onMouseUp = () => {
                        if (this.destroyed) return;          // ← leaks _isMousePressed === true
                        this._isMousePressed = false;
                        this.update(view, startState);
                    };
                    document.addEventListener('mouseup', onMouseUp, {once: true});
                },
            },
        };
    }

    view(view) {
        this.update(view);                                    // ← no re-arm of the two flags
        return {
            update: this.update.bind(this),
            destroy: () => {
                this.destroyed = true;                        // ← sticks across re-creation
                ...
            },
        };
    }

    update(view, prevState) {
        this.editorView = view;
        if (this._isMousePressed) return;                     // ← everything dies here afterwards
        ...
    }
}
```

## A second, related flaw in the same handler

Even with healthy flags, the `mouseup` re-evaluation passes the state **snapshotted at
`mousedown`** (`startState`), and `update()` early-returns when doc + selection are unchanged
since then:

```js
if (prevState && prevState.doc.eq(state.doc) && prevState.selection.eq(state.selection)) {
  return;
}
```

The `mousedown` just hid the tooltip — so any press-release cycle that ends with the same
selection it started with (e.g. a click on an existing selection that ProseMirror keeps, or a
double-click whose word-selection was already flushed into PM state before the handler snapshot)
strands the tooltip hidden while a non-empty selection is live on screen.

## Suggested fix

```js
view(view) {
    this.destroyed = false;        // re-arm: plugin views are re-created far more often
    this._isMousePressed = false;  // than plugins are
    this.update(view);
    ...
}
```

and in the `mouseup` handler, re-evaluate without the stale snapshot (or only take the
unchanged-selection early return when the tooltip is currently open):

```js
const onMouseUp = () => {
  if (this.destroyed) return;
  this._isMousePressed = false;
  this.update(view); // no startState: mousedown just hid the tooltip,
}; // so "unchanged" must not mean "keep hidden"
```

We ship a vendored copy of the plugin with exactly these two changes
(`src/components/editor/selectionContextFix.ts` in
[gravity-notes](https://github.com/resure/gravity-notes), commit `f354511`) and verified the
before/after behavior end-to-end in a packaged app with the plugin's gate decisions instrumented:
before — `mousedown → mouseup → (nothing)`, toolbar dead; after — `mousedown → mouseup → SHOW`.

## Environment

- `@gravity-ui/markdown-editor` 15.41.0, WYSIWYG mode, `full` preset
- React 18, ProseMirror as bundled
- Reproduced on macOS (WKWebView / Tauri 2 shell) and applies engine-independently — the trigger
  is plugin-view recreation, not the browser
