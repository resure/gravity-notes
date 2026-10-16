import {useRef, useState} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {useAnchoredOverlay} from './useAnchoredOverlay';

/** The ids in a heading's `{#id}` suffix, space-separated and without the braces. */
export function anchorIds(suffix: string | undefined): string[] {
    return Array.from(suffix?.matchAll(/\{#([^\s{}]+)\}/g) ?? [], (match) => match[1]);
}

/**
 * The suffix for the ids typed into the editor, or undefined to drop it. An unchanged set keeps the
 * original spelling, spacing included, so opening and closing the editor never rewrites the line.
 */
export function anchorSuffix(typed: string, original: string | undefined): string | undefined {
    const ids = typed
        .split(/\s+/)
        .map((id) => id.replace(/^#/, '').replace(/[{}]/g, ''))
        .filter(Boolean);
    if (ids.length === 0) return undefined;
    if (ids.join(' ') === anchorIds(original).join(' ')) return original;
    return ids.map((id) => ` {#${id}}`).join('');
}

interface AnchorEditorProps {
    /** VIEWPORT coordinates of what opened it (the editor is `position: fixed`). */
    x: number;
    y: number;
    anchor: string | undefined;
    /** `fromKeyboard` is false for a click elsewhere, which must keep the focus it moved. */
    onSave: (anchor: string | undefined, fromKeyboard: boolean) => void;
    /** Escape: discard. */
    onClose: () => void;
}

/**
 * Edit a heading's `{#id}` anchor. Enter or clicking away saves; Escape discards; clearing the field
 * removes the anchor.
 */
export default function AnchorEditor({x, y, anchor, onSave, onClose}: AnchorEditorProps) {
    const [text, setText] = useState(() => anchorIds(anchor).join(' '));
    const textRef = useRef(text);
    textRef.current = text;
    const save = (fromKeyboard: boolean) =>
        onSave(anchorSuffix(textRef.current, anchor), fromKeyboard);
    const {ref, style} = useAnchoredOverlay({
        x,
        y,
        onClose: () => save(false),
        // A frame later: the overlay is still `visibility: hidden` when it is placed, and a hidden
        // input cannot take focus.
        onPlaced: (element) =>
            window.requestAnimationFrame(() => element.querySelector('input')?.select()),
    });

    return (
        <OverlayPortal>
            <div
                ref={ref}
                className="overlay-menu anchor-editor"
                style={style}
                role="dialog"
                aria-label="Heading anchor"
            >
                <span className="anchor-editor-hash" aria-hidden>
                    #
                </span>
                <input
                    aria-label="Anchor id"
                    placeholder="anchor-id"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            save(true);
                        } else if (event.key === 'Escape') {
                            // Handled, so EditorPane's Esc ladder leaves focus in the editor.
                            event.preventDefault();
                            onClose();
                        }
                    }}
                />
            </div>
        </OverlayPortal>
    );
}
