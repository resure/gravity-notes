import {type ExtensionBuilder} from '@gravity-ui/markdown-editor';
import {Plugin} from 'prosemirror-state';

import {openExternalUrl} from '../../openExternal';

/** The anchor element under a mouse event, but only when it actually carries an `href`. */
function linkAnchor(event: MouseEvent): HTMLAnchorElement | null {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a');
    return anchor && anchor.getAttribute('href') ? anchor : null;
}

/**
 * Class set on the editable while ⌘/Ctrl is held, so CSS can switch links to a pointer cursor —
 * signalling they're clickable before the user commits to the click. See `EditorPane.css`.
 */
const MOD_PRESSED_CLASS = 'g-prosemirror_mod-pressed';

/**
 * Wysiwyg extension: ⌘/Ctrl-click a link to open it straight away, skipping the link-edit tooltip.
 *
 * That tooltip is driven by the cursor landing inside a link mark, so we cancel the modified
 * `mousedown` (blocking caret placement → the tooltip never opens) and open the URL on `click`.
 * Plain clicks are untouched, so editing a link still works as before. Added at `Priority.VeryHigh`
 * so it sees the events before the built-in link plugins. The plugin's `view` also toggles a class
 * on the editable while the modifier is held, so links take a pointer cursor (a clickable hint).
 */
export function openLinkExtension(builder: ExtensionBuilder): void {
    builder.addPlugin(
        () =>
            new Plugin({
                view(editorView) {
                    const root = editorView.dom;
                    // Reflect the live modifier state onto the editable. Listening on the document
                    // (capture) means it tracks even while the mouse, not the keyboard, has focus.
                    const sync = (event: KeyboardEvent) => {
                        root.classList.toggle(MOD_PRESSED_CLASS, event.metaKey || event.ctrlKey);
                    };
                    const clear = () => root.classList.remove(MOD_PRESSED_CLASS);
                    document.addEventListener('keydown', sync, true);
                    document.addEventListener('keyup', sync, true);
                    // Releasing the key outside the window (e.g. ⌘-tab away) never fires keyup here.
                    window.addEventListener('blur', clear);
                    return {
                        destroy() {
                            document.removeEventListener('keydown', sync, true);
                            document.removeEventListener('keyup', sync, true);
                            window.removeEventListener('blur', clear);
                        },
                    };
                },
                props: {
                    handleDOMEvents: {
                        mousedown(_view, event) {
                            if ((event.metaKey || event.ctrlKey) && linkAnchor(event)) {
                                event.preventDefault();
                                return true;
                            }
                            return false;
                        },
                        click(_view, event) {
                            if (!event.metaKey && !event.ctrlKey) return false;
                            const anchor = linkAnchor(event);
                            if (!anchor) return false;
                            event.preventDefault();
                            // `.href` is the browser-resolved absolute URL (keeps mailto:/tel: schemes).
                            openExternalUrl(anchor.href);
                            return true;
                        },
                    },
                },
            }),
        builder.Priority.VeryHigh,
    );
}
