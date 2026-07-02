import type {Logger2, SelectionContextConfig} from '@gravity-ui/markdown-editor';
import {
    SelectionContext,
    hideSelectionMenu,
} from '@gravity-ui/markdown-editor/_/extensions/behavior/SelectionContext/index.js';
import {ExtensionBuilder} from '@gravity-ui/markdown-editor/core';
import {Schema} from 'prosemirror-model';
import type {Plugin} from 'prosemirror-state';
import {EditorState, TextSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {describe, expect, it} from 'vitest';

import {fixedSelectionContext} from './selectionContextFix';

// Pins the load-bearing assumptions behind the vendored selection-toolbar fix, so an
// @gravity-ui/markdown-editor bump that invalidates any of them fails HERE instead of silently
// re-breaking the toolbar (the original bug needed an instrumented packaged app to even detect):
//  - the stock SelectionContext skips registration for an empty config — what EditorPane's
//    `selectionContext: {config: []}` disable relies on (otherwise: two toolbars);
//  - the bundle's `hideSelectionMenu` still sets the 'hide-selection-menu' meta string the
//    vendored plugin reads (its Search/Selection commands hide the menu through it);
//  - the vendored plugin registers at High priority (its Escape handler must precede the
//    preset's unconditional Escape consumers, e.g. the Search keymap);
//  - the vendored fixes themselves: flags re-arm on plugin-view re-creation (fix 1), the mouseup
//    re-check ignores the mousedown snapshot (fix 2), and non-left presses / native drags can't
//    wedge the mouseup gate (fix 3).

const schema = new Schema({
    nodes: {
        doc: {content: 'block+'},
        paragraph: {group: 'block', content: 'inline*', toDOM: () => ['p', 0]},
        text: {group: 'inline'},
    },
});

const noopLogger = {
    log() {},
    warn() {},
    error() {},
    action() {},
    metrics() {},
    event() {},
    nested() {
        return this;
    },
    on() {},
    off() {},
} as unknown as Logger2.ILogger;

/** One non-empty menu group — the registration gates only look at `config.length`. */
const MENU_CONFIG = [[]] as unknown as SelectionContextConfig;

/** Register the STOCK extension with `config` and count the plugins it actually adds. */
function stockPluginCount(config: unknown): number {
    const builder = new ExtensionBuilder(noopLogger);
    builder.use(SelectionContext as never, {config} as never);
    return builder.build().plugins({actions: {}} as never).length;
}

/** Run `fixedSelectionContext` through a stub builder; return the built plugin + its priority. */
function buildFixedPlugin() {
    let factory: ((deps: never) => Plugin) | undefined;
    let priority: unknown;
    const builder = {
        logger: noopLogger,
        Priority: ExtensionBuilder.Priority,
        addPlugin(cb: (deps: never) => Plugin, prio?: unknown) {
            factory = cb;
            priority = prio;
            return this;
        },
    };
    fixedSelectionContext(builder as unknown as ExtensionBuilder, {config: MENU_CONFIG});
    const plugin = factory!({actions: {}} as never);

    // Swap the real TooltipView (React portal — can't render here) for a call recorder. The
    // field is TS-private only, so a structural cast reaches it without touching the vendor.
    const calls = {show: 0, hide: 0};
    const tooltip = {
        isTooltipOpen: false,
        show: () => void calls.show++,
        hide: () => void calls.hide++,
        destroy: () => {},
    };
    (plugin.spec as unknown as {tooltip: unknown}).tooltip = tooltip;

    const spec = plugin.spec as unknown as {
        view: (v: EditorView) => {
            update: (v: EditorView, prev?: EditorState) => void;
            destroy: () => void;
        };
    };
    return {plugin, spec, priority, calls, tooltip};
}

/** A minimal focused "view" over a doc with a live text selection — enough for update()'s gates. */
function makeView(plugin: Plugin): EditorView {
    const doc = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text('hello world')),
    ]);
    const state = EditorState.create({
        schema,
        doc,
        plugins: [plugin],
        selection: TextSelection.create(doc, 1, 6),
    });
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    return {state, dom, hasFocus: () => true} as unknown as EditorView;
}

const mouse = (button: number) => new MouseEvent('mousedown', {button});
const esc = (init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', {key: 'Escape', ...init});

/**
 * The built plugin's props, freed of prosemirror's `this: Plugin` context typing — the handlers
 * under test are arrows over the class instance (and bindProps re-binds), so detached calls are
 * runtime-safe.
 */
function propsOf(plugin: Plugin) {
    return plugin.props as unknown as {
        handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean;
        handleDOMEvents: {
            mousedown: (view: EditorView, event: MouseEvent) => void;
            dragstart: (view: EditorView, event: Event) => void;
        };
    };
}

describe('stock SelectionContext coupling (what the EditorPane disable relies on)', () => {
    it('skips registration for an empty config', () => {
        expect(stockPluginCount([])).toBe(0);
    });

    it('registers for a non-empty config — the empty array is the discriminator', () => {
        expect(stockPluginCount([[]])).toBe(1);
    });

    it("hideSelectionMenu sets the exact meta string the vendored plugin's state reads", () => {
        const state = EditorState.create({schema});
        expect(hideSelectionMenu(state.tr).getMeta('hide-selection-menu')).toBe(true);
    });
});

describe('fixedSelectionContext', () => {
    it('registers nothing for an empty config (parity with stock)', () => {
        let added = 0;
        const builder = {
            logger: noopLogger,
            Priority: ExtensionBuilder.Priority,
            addPlugin() {
                added++;
                return this;
            },
        };
        fixedSelectionContext(builder as unknown as ExtensionBuilder, {
            config: [] as unknown as SelectionContextConfig,
        });
        expect(added).toBe(0);
    });

    it('registers at High priority, ahead of the preset keymaps that eat Escape unconditionally', () => {
        const {priority} = buildFixedPlugin();
        expect(priority).toBe(ExtensionBuilder.Priority.High);
    });

    it('fix 1: mousedown → mouseup still shows the toolbar after a plugin-view destroy/re-create', () => {
        const {plugin, spec, calls} = buildFixedPlugin();
        const view = makeView(plugin);
        spec.view(view).destroy(); // the note-switch teardown (stock stayed `destroyed` forever)
        spec.view(view); // re-creation — THE re-arm under test
        calls.show = 0;
        calls.hide = 0;
        propsOf(plugin).handleDOMEvents.mousedown(view, mouse(0));
        expect(calls.hide).toBe(1); // mousedown hides…
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(calls.show).toBe(1); // …and the mouseup re-check runs (stock: ignored, wedged)
    });

    it('fix 2: the mouseup re-check ignores the mousedown snapshot (click on a kept selection)', () => {
        const {plugin, spec, calls} = buildFixedPlugin();
        const view = makeView(plugin);
        spec.view(view); // fresh plugin view, no teardown involved
        calls.show = 0;
        calls.hide = 0;
        propsOf(plugin).handleDOMEvents.mousedown(view, mouse(0));
        document.dispatchEvent(new MouseEvent('mouseup'));
        // Doc + selection are byte-identical to the mousedown snapshot — stock early-returned
        // here and stranded the toolbar hidden over a live selection.
        expect(calls.show).toBe(1);
    });

    it('fix 3: a non-left press hides but does not wedge the mouseup gate', () => {
        const {plugin, spec, calls} = buildFixedPlugin();
        const view = makeView(plugin);
        const pluginView = spec.view(view);
        calls.show = 0;
        calls.hide = 0;
        propsOf(plugin).handleDOMEvents.mousedown(view, mouse(2));
        expect(calls.hide).toBe(1); // still hides, like stock…
        // …but with NO document mouseup ever (macOS context menu swallows it), a later
        // keyboard-driven update must still reach the tooltip (stock: gated forever):
        pluginView.update(view);
        expect(calls.show).toBe(1);
    });

    it('fix 3, drag half: dragstart un-gates a left press that became a native drag', () => {
        const {plugin, spec, calls} = buildFixedPlugin();
        const view = makeView(plugin);
        const pluginView = spec.view(view);
        calls.show = 0;
        calls.hide = 0;
        propsOf(plugin).handleDOMEvents.mousedown(view, mouse(0));
        propsOf(plugin).handleDOMEvents.dragstart(view, new Event('dragstart'));
        pluginView.update(view); // a drag ends with dragend, not mouseup — must not stay gated
        expect(calls.show).toBe(1);
        document.dispatchEvent(new MouseEvent('mouseup')); // flush the armed once-listener
    });

    it('Escape hides the open toolbar; modified Escape falls through to other keymaps', () => {
        const {plugin, calls, tooltip} = buildFixedPlugin();
        const view = makeView(plugin);
        tooltip.isTooltipOpen = true;
        expect(propsOf(plugin).handleKeyDown(view, esc())).toBe(true);
        expect(calls.hide).toBe(1);
        // Alt-Shift-Escape is selectParentNode upstream — keydownHandler's modifier-strict
        // matching must let it pass (a bare `event.key === 'Escape'` check would swallow it).
        expect(propsOf(plugin).handleKeyDown(view, esc({altKey: true, shiftKey: true}))).toBe(
            false,
        );
        expect(calls.hide).toBe(1);
    });
});
