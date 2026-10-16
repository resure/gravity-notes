/**
 * The colour palette both surfaces that apply one show: the block menu (a whole block) and the
 * selection toolbar (a span of text). Swatches read the theme-aware note palette in index.css, so
 * each previews the colour exactly as it will paint in the current theme.
 */

import {Fragment} from 'react';
import type {CSSProperties} from 'react';

import {colorClassFor, colorFromClass} from '../../markdown/color';

import type {BlockColor} from './types';

export interface ColorOption {
    value: BlockColor;
    label: string;
    swatch: string;
}

export const COLOR_OPTIONS: ColorOption[] = [
    {value: 'default', label: 'Default', swatch: 'var(--n-text)'},
    {value: 'gray', label: 'Gray text', swatch: 'var(--gn-color-gray)'},
    {value: 'brown', label: 'Brown text', swatch: 'var(--gn-color-brown)'},
    {value: 'orange', label: 'Orange text', swatch: 'var(--gn-color-orange)'},
    {value: 'yellow', label: 'Yellow text', swatch: 'var(--gn-color-yellow)'},
    {value: 'green', label: 'Green text', swatch: 'var(--gn-color-green)'},
    {value: 'blue', label: 'Blue text', swatch: 'var(--gn-color-blue)'},
    {value: 'purple', label: 'Purple text', swatch: 'var(--gn-color-purple)'},
    {value: 'pink', label: 'Pink text', swatch: 'var(--gn-color-pink)'},
    {value: 'red', label: 'Red text', swatch: 'var(--gn-color-red)'},
    {value: 'gray_background', label: 'Gray background', swatch: 'var(--gn-color-gray-bg)'},
    {value: 'brown_background', label: 'Brown background', swatch: 'var(--gn-color-brown-bg)'},
    {value: 'orange_background', label: 'Orange background', swatch: 'var(--gn-color-orange-bg)'},
    {value: 'yellow_background', label: 'Yellow background', swatch: 'var(--gn-color-yellow-bg)'},
    {value: 'green_background', label: 'Green background', swatch: 'var(--gn-color-green-bg)'},
    {value: 'blue_background', label: 'Blue background', swatch: 'var(--gn-color-blue-bg)'},
    {value: 'purple_background', label: 'Purple background', swatch: 'var(--gn-color-purple-bg)'},
    {value: 'pink_background', label: 'Pink background', swatch: 'var(--gn-color-pink-bg)'},
    {value: 'red_background', label: 'Red background', swatch: 'var(--gn-color-red-bg)'},
];

/** Where the background half of the palette starts. */
const BACKGROUND_COLORS_AT = 10;

const SECTIONS = [
    {title: 'Text color', options: COLOR_OPTIONS.slice(0, BACKGROUND_COLORS_AT)},
    {title: 'Background color', options: COLOR_OPTIONS.slice(BACKGROUND_COLORS_AT)},
];

export function swatchStyle(color: ColorOption): CSSProperties {
    return color.value.endsWith('_background') ? {background: color.swatch} : {color: color.swatch};
}

/**
 * The palette itself, rendered the same way wherever a colour is chosen — the block menu (a whole
 * block) and the selection toolbar (a run of words).
 *
 * Written once because it had already drifted: three near-identical grids, and the toolbar's
 * swatches had lost the `aria-pressed` the menu's carry.
 */
export function ColorPalette({
    current,
    onPick,
}: {
    /** The colour already applied, marked as pressed. Absent where there is nothing to mark. */
    current?: BlockColor;
    onPick: (color: BlockColor) => void;
}) {
    return (
        <>
            {SECTIONS.map((section) => (
                <Fragment key={section.title}>
                    <div className="menu-section">{section.title}</div>
                    <div className="color-grid">
                        {section.options.map((color) => {
                            const selected = current === color.value;
                            return (
                                <button
                                    type="button"
                                    key={color.value}
                                    className={`color-swatch${selected ? ' selected' : ''}`}
                                    title={color.label}
                                    aria-label={color.label}
                                    aria-pressed={selected}
                                    // Keeps the caret (and so the text selection) where it is: the
                                    // toolbar acts on what is selected, and a focus grab would have
                                    // dropped it before the click landed.
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onPick(color.value)}
                                >
                                    <span style={swatchStyle(color)}>A</span>
                                </button>
                            );
                        })}
                    </div>
                </Fragment>
            ))}
        </>
    );
}

/**
 * Colour the selected text inside `root` — the inline half of the palette (the block menu colours a
 * whole block). The range is rebuilt rather than handed to `execCommand`: the browser's own
 * `foreColor` writes inline styles that the editor's sanitizer strips, and a background has no
 * command at all.
 *
 * Colours nest, and the innermost wins in both CSS and the file's `{red}({blue}(…))`. Default is
 * therefore the one case that has to REMOVE something, and it removes any colour the selection
 * touches, including one that started outside it — a colour you cannot see the end of is worse
 * than one that gives up more than you asked.
 */
export function colorSelection(color: BlockColor, root: HTMLElement | null): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !root) return false;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;
    if (color === 'default') {
        const ancestor = (
            range.commonAncestorContainer instanceof Element
                ? range.commonAncestorContainer
                : range.commonAncestorContainer.parentElement
        )?.closest('span');
        if (ancestor && colorFromClass(ancestor.className) && root.contains(ancestor)) {
            ancestor.replaceWith(...ancestor.childNodes);
        }
    }
    const fragment = range.extractContents();
    for (const span of [...fragment.querySelectorAll('span')]) {
        if (colorFromClass(span.className)) span.replaceWith(...span.childNodes);
    }
    let inserted: Node = fragment;
    if (color !== 'default') {
        const span = document.createElement('span');
        span.className = colorClassFor(color);
        span.appendChild(fragment);
        inserted = span;
    }
    range.insertNode(inserted);
    sel.removeAllRanges();
    const restored = document.createRange();
    restored.selectNodeContents(inserted);
    sel.addRange(restored);
    return true;
}
