/**
 * The colour palette both surfaces that apply one show: the block menu (a whole block) and the
 * selection toolbar (a span of text). The swatch is the menu's own dot, deliberately a literal — it
 * is a control's fill, not note content, so unlike the palette in index.css it does not follow the
 * theme.
 */

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
export const BACKGROUND_COLORS_AT = 10;
