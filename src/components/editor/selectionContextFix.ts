import type {ActionStorage, ExtensionBuilder, Logger2} from '@gravity-ui/markdown-editor';
import {
    type ContextConfig,
    TooltipView,
} from '@gravity-ui/markdown-editor/_/extensions/behavior/SelectionContext/tooltip.js';
import {isCodeBlock} from '@gravity-ui/markdown-editor/_/utils/nodes.js';
import {AllSelection, Plugin, PluginKey, TextSelection} from 'prosemirror-state';
import type {EditorState, Selection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

/**
 * The floating selection toolbar (the bundle's `SelectionContext` behavior), vendored from
 * `@gravity-ui/markdown-editor` 15.41.0 with two fixes. The stock plugin went PERMANENTLY dead
 * after the first note switch + click:
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
 *
 * (Why this looked prod-only: the death needs a note switch first. The reused editor only runs
 * resetHistory on a real switch, so a fresh session's first note keeps a live toolbar — matching
 * "works in dev, broken in prod" until the real trigger was isolated in a packaged-app selftest.)
 *
 * Everything else is verbatim from the bundle. Wired in EditorPane: the stock plugin is disabled
 * via `selectionContext: {config: []}` (the bundle skips it for an empty config) and this one is
 * registered with the real config instead.
 */
export const fixedSelectionContext = (
    builder: ExtensionBuilder,
    opts: {config: ContextConfig; placement?: 'top' | 'bottom'; flip?: boolean},
) => {
    if (opts.config.length > 0) {
        builder.addPlugin(
            ({actions}) =>
                new Plugin(new SelectionTooltip(actions, opts.config, builder.logger, opts)),
        );
    }
};

/** Same meta key the bundle's `hideSelectionMenu` sets, so its callers keep hiding this menu too. */
const HideMetaKey = 'hide-selection-menu';

const pluginKey = new PluginKey<{disabled: boolean}>('selection-context-fixed');

/** `prosemirror-utils`' hasParentNode, inlined: any ancestor of the selection matches `pred`. */
function selectionHasParent(
    selection: Selection,
    pred: (node: {type: {spec: {selectionContext?: boolean}}}) => boolean,
): boolean {
    const {$from} = selection;
    for (let depth = $from.depth; depth > 0; depth--) {
        if (pred($from.node(depth))) return true;
    }
    return false;
}

class SelectionTooltip {
    private destroyed = false;
    private tooltip: TooltipView;
    private editorView: EditorView | null = null;
    private hideTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    private _isMousePressed = false;

    constructor(
        actions: ActionStorage,
        menuConfig: ContextConfig,
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
            handleKeyDown: (view, event) => {
                // Esc hides the open context menu (and is swallowed); otherwise fall through.
                if (event.key === 'Escape' && this.tooltip.isTooltipOpen) {
                    this.tooltip.hide(view);
                    return true;
                }
                return false;
            },
            handleDOMEvents: {
                mousedown: (view) => {
                    this._isMousePressed = true;
                    this.cancelTooltipHiding();
                    this.tooltip.hide(view);
                    const onMouseUp = () => {
                        if (this.destroyed) return;
                        this._isMousePressed = false;
                        // THE FIX (see the module comment): re-evaluate with NO prev-state
                        // snapshot, so the unchanged-selection early-return can't strand the
                        // tooltip in the hidden state the mousedown above just put it in.
                        this.update(view);
                    };
                    document.addEventListener('mouseup', onMouseUp, {once: true});
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
        // THE FIX, part 1 (see the module comment): re-arm after a plugin-view teardown.
        // ProseMirror destroys + re-creates every plugin view whenever the state's plugins array
        // changes identity — which happens on each note switch (EditorPane's resetHistory swaps in
        // a fresh EditorState). The stock plugin never reset these flags on re-creation: destroyed
        // stayed true, so the next mousedown hid the tooltip and its mouseup was ignored — and
        // _isMousePressed then stuck true, gating every later update. Net effect: the selection
        // toolbar went permanently dead after the first note switch + click.
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
            selectionHasParent(selection, (node) => node.type.spec.selectionContext === false)
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
