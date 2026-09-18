/**
 * The colour palette both surfaces that apply one show: the block menu (a whole block) and the
 * selection toolbar (a span of text). The swatch is the menu's own dot, deliberately a literal — it
 * is a control's fill, not note content, so unlike the palette in index.css it does not follow the
 * theme.
 */

import {Fragment} from 'react';

import type {BlockColor} from './types';

export interface ColorOption {
    value: BlockColor;
    label: string;
    swatch: string;
}

export const COLOR_OPTIONS: ColorOption[] = [
    {value: 'default', label: 'Default', swatch: '#ffffff'},
    {value: 'gray', label: 'Gray text', swatch: '#787774'},
    {value: 'brown', label: 'Brown text', swatch: '#976d57'},
    {value: 'orange', label: 'Orange text', swatch: '#cc782f'},
    {value: 'yellow', label: 'Yellow text', swatch: '#c29343'},
    {value: 'green', label: 'Green text', swatch: '#548164'},
    {value: 'blue', label: 'Blue text', swatch: '#487ca5'},
    {value: 'purple', label: 'Purple text', swatch: '#8a67ab'},
    {value: 'pink', label: 'Pink text', swatch: '#b35488'},
    {value: 'red', label: 'Red text', swatch: '#c4554d'},
    {value: 'gray_background', label: 'Gray background', swatch: '#e7e5e4'},
    {value: 'brown_background', label: 'Brown background', swatch: '#eee0da'},
    {value: 'orange_background', label: 'Orange background', swatch: '#fadec9'},
    {value: 'yellow_background', label: 'Yellow background', swatch: '#fdecc8'},
    {value: 'green_background', label: 'Green background', swatch: '#dbeddb'},
    {value: 'blue_background', label: 'Blue background', swatch: '#d3e5ef'},
    {value: 'purple_background', label: 'Purple background', swatch: '#e8deee'},
    {value: 'pink_background', label: 'Pink background', swatch: '#f5e0e9'},
    {value: 'red_background', label: 'Red background', swatch: '#ffe2dd'},
];

/** Where the background half of the palette starts. */
const BACKGROUND_COLORS_AT = 10;

const SECTIONS = [
    {title: 'Text color', options: COLOR_OPTIONS.slice(0, BACKGROUND_COLORS_AT), ink: true},
    {title: 'Background color', options: COLOR_OPTIONS.slice(BACKGROUND_COLORS_AT), ink: false},
];

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
                                    <span
                                        style={
                                            section.ink
                                                ? {color: color.swatch}
                                                : {background: color.swatch}
                                        }
                                    >
                                        A
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Fragment>
            ))}
        </>
    );
}
