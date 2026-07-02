import type {
    ActionStorage,
    ExtensionBuilder,
    Logger2,
    SelectionContextConfig,
} from '@gravity-ui/markdown-editor';
import {TooltipView} from '@gravity-ui/markdown-editor/_/extensions/behavior/SelectionContext/tooltip.js';
import {isCodeBlock} from '@gravity-ui/markdown-editor/_/utils/nodes.js';
import {keydownHandler} from '@gravity-ui/markdown-editor/pm/keymap.js';
import {hasParentNode} from '@gravity-ui/markdown-editor/pm/utils.js';
import {AllSelection, Plugin, PluginKey, TextSelection} from 'prosemirror-state';
import type {EditorState} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

/**
 * The floating selection toolbar (the bundle's `SelectionContext` behavior), vendored from
 * `@gravity-ui/markdown-editor` 15.41.0 — the version is pinned exact in package.json BECAUSE of
 * this file: on every editor bump, re-diff against the bundle's SelectionContext source, and DROP
 * the whole file once upstream re-arms the flags (upstream report: EDITOR_BUG_REPORT.md, to be
 * filed against gravity-ui/markdown-editor — link the issue URL here once it exists). The stock
 * plugin went PERMANENTLY dead after the first
 * note switch + click; three behavior fixes:
 *
 * 1. Our note-switch history reset (EditorPane's resetHistory) swaps in a fresh EditorState, whose
 *    plugins array has a new identity — so ProseMirror destroys + re-creates every plugin view.
 *    The stock plugin sets `destroyed = true` in that teardown but never re-arms on re-creation:
 *    the next mousedown hides the tooltip, its mouseup is ignored (`if (destroyed) return`), and
 *    `_isMousePressed` then sticks true, short-circuiting every later update. Fixed in `view()`:
 *    reset both flags when the plugin view is (re-)created.
 * 2. The mouseup re-evaluation passed the state snapshotted at mousedown, and `update()` skips
 *    when doc + selection are unchanged since then — which strands the tooltip in the hidden state
 *    the mousedown just put it in whenever a press-release cycle ends with the same selection
 *    (e.g. a click on an existing selection). Fixed in `onMouseUp`: re-evaluate with no snapshot.
 * 3. The mouseup gate armed on ANY button, but some presses never deliver a document mouseup — a
 *    right-click on macOS (the native context menu opens during mousedown and swallows the
 *    release) or a press that becomes a native drag (ends with dragend) — wedging
 *    `_isMousePressed` true, i.e. no toolbar for keyboard-driven selections until the next
 *    completed left click. Fixed in the mousedown handler (gate on the left button only; a
 *    non-left press still hides, like stock) plus a dragstart un-gate.
 *
 * (Why this looked prod-only: the death needs a note switch first. The reused editor only runs
 * resetHistory on a real switch, so a fresh session's first note keeps a live toolbar — matching
 * "works in dev, broken in prod" until the real trigger was isolated in a packaged-app selftest.)
 *
 * Everything else is verbatim from the bundle, via its public `pm/*` re-exports where they exist
 * (keydownHandler, hasParentNode) — only TooltipView needs the internal `_/*` hatch. Wired in
 * EditorPane: the stock plugin is disabled via `selectionContext: {config: []}` (the bundle skips
 * registration for an empty config — selectionContextFix.test.tsx pins that assumption) and this
 * one is registered with the real config instead.
 */
export const fixedSelectionContext = (
    builder: ExtensionBuilder,
    opts: {config: SelectionContextConfig; placement?: 'top' | 'bottom'; flip?: boolean},
) => {
    if (opts.config.length > 0) {
        builder.addPlugin(
            ({actions}) =>
                new Plugin(new SelectionTooltip(actions, opts.config, builder.logger, opts)),
            // High, not the default Medium: user extensions register after the whole bundle
            // preset, whose Search keymap (`Escape: closeSearch` — returns true even with the
            // search bar closed) and EditorModeKeymap (unconditional Escape → onCancel) would
            // otherwise consume Escape before this plugin's hide-the-toolbar handler. The stock
            // plugin sat before both inside BehaviorPreset; High restores that dispatch order.
            builder.Priority.High,
        );
    }
};

/** Same meta key the bundle's `hideSelectionMenu` sets, so its callers keep hiding this menu too. */
const HideMetaKey = 'hide-selection-menu';

const pluginKey = new PluginKey<{disabled: boolean}>('selection-context-fixed');

class SelectionTooltip {
    private destroyed = false;
    private tooltip: TooltipView;
    private editorView: EditorView | null = null;
    private hideTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    private _isMousePressed = false;

    constructor(
        actions: ActionStorage,
        menuConfig: SelectionContextConfig,
        logger: Logger2.ILogger,
        options: {placement?: 'top' | 'bottom'; flip?: boolean},
    ) {
        this.tooltip = new TooltipView(actions, menuConfig, logger, {
            ...options,
            onPopupOpenChange: (_open, _event, reason) => {
                if (reason !== 'escape-key' && this.editorView)
                    this.scheduleTooltipHiding(this.editorView);
            },
        });
    }

    get key() {
        return pluginKey;
    }

    get props(): Plugin['props'] {
        return {
            // same as keymap({})
            handleKeyDown: keydownHandler({
                // hide context menu when Esc was pressed
                Escape: (_state, _dispatch, view) => {
                    if (view && this.tooltip.isTooltipOpen) {
                        this.tooltip.hide(view);
                        return true;
                    }
                    return false;
                },
            }),
            handleDOMEvents: {
                mousedown: (view, event) => {
                    // FIX 3 (see the module docblock): only a left press arms the mouseup gate —
                    // a non-left press (context menu, and any press that turns into a drag) may
                    // never deliver the document mouseup that resets it. Still hide, like stock.
                    if (event.button !== 0) {
                        this.cancelTooltipHiding();
                        this.tooltip.hide(view);
                        return;
                    }
                    this._isMousePressed = true;
                    this.cancelTooltipHiding();
                    this.tooltip.hide(view);
                    const onMouseUp = () => {
                        if (this.destroyed) return;
                        this._isMousePressed = false;
                        // FIX 2 (see the module docblock): re-evaluate with NO prev-state
                        // snapshot, so the unchanged-selection early-return can't strand the
                        // tooltip in the hidden state the mousedown above just put it in.
                        this.update(view);
                    };
                    document.addEventListener('mouseup', onMouseUp, {once: true});
                },
                // FIX 3, drag half: a native drag ends with dragend, not mouseup — un-gate here
                // (the already-armed once-listener later runs one harmless idempotent update).
                dragstart: () => {
                    this._isMousePressed = false;
                    return false;
                },
            },
        };
    }

    get state(): Plugin['spec']['state'] {
        return {
            init: () => ({disabled: false}),
            apply(tr) {
                return {disabled: Boolean(tr.getMeta(HideMetaKey))};
            },
        };
    }

    view(view: EditorView) {
        // FIX 1 (see the module docblock): plugin views are destroyed + re-created on every note
        // switch (resetHistory's state swap changes the plugins-array identity); the stock plugin
        // never reset these flags afterwards, leaving the toolbar permanently dead. Re-arm here.
        this.destroyed = false;
        this._isMousePressed = false;
        this.update(view);
        return {
            update: this.update.bind(this),
            destroy: () => {
                this.destroyed = true;
                this.cancelTooltipHiding();
                this.tooltip.destroy();
            },
        };
    }

    private update(view: EditorView, prevState?: EditorState) {
        this.editorView = view;
        if (this._isMousePressed) return;
        this.cancelTooltipHiding();
        const hideFromTr = pluginKey.getState(view.state)?.disabled;
        // Don't show tooltip if editor not mounted to the DOM
        if (hideFromTr || !view.dom.parentNode) {
            this.tooltip.hide(view);
            return;
        }
        const {state} = view;
        // Don't do anything if the document/selection didn't change
        if (prevState && prevState.doc.eq(state.doc) && prevState.selection.eq(state.selection)) {
            return;
        }
        // Don't show tooltip if editor out of focus
        if (!view.hasFocus()) {
            this.tooltip.hide(view);
            return;
        }
        const {selection} = state;
        // Hide the tooltip if the selection is empty
        if (
            selection.empty ||
            !(selection instanceof TextSelection || selection instanceof AllSelection)
        ) {
            this.tooltip.hide(view);
            return;
        }
        if (
            // Hide tooltip when one side of selection is inside a codeblock
            isCodeBlock(selection.$from.parent) ||
            isCodeBlock(selection.$to.parent) ||
            // or when selection is inside node where context menu is disabled
            hasParentNode((node) => node.type.spec.selectionContext === false)(selection)
        ) {
            this.tooltip.hide(view);
            return;
        }
        this.tooltip.show(view);
    }

    private scheduleTooltipHiding(view: EditorView) {
        this.hideTimeoutRef = setTimeout(() => {
            // hide tooltip if view is out of focus after 30 ms
            if (!view.hasFocus()) {
                this.tooltip.hide(view);
            }
        }, 30);
    }

    private cancelTooltipHiding() {
        if (this.hideTimeoutRef !== null) {
            clearTimeout(this.hideTimeoutRef);
            this.hideTimeoutRef = null;
        }
    }
}
