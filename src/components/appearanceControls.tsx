import type {ReactNode} from 'react';

import {SegmentedRadioGroup, Text} from '@gravity-ui/uikit';

import type {
    AccentColor,
    AccentColorPref,
    EditorFont,
    EditorFontPref,
    TextWidth,
    TextWidthPref,
} from '../hooks/useSettings';

import './appearanceControls.css';

/**
 * Shared option arrays, accent swatch, and picker row for the appearance `SegmentedRadioGroup`s,
 * used by both the Settings dialog (app + workspace scopes) and the per-note appearance popover.
 * The `_WS` variants prepend a `Default` (inherit) entry — used by the workspace and per-note scopes.
 */

export interface AppearanceChoiceRowProps<T extends string> {
    label: string;
    options: {value: T; content: ReactNode}[];
    value: T;
    onUpdate: (value: T) => void;
    /**
     * `row` — a fixed label column with the control beside it (Settings dialog);
     *  `stack` — a small label above a full-width control (note-appearance popover).
     */
    layout: 'row' | 'stack';
}

/** One appearance picker: a label + segmented control, in the layout its host needs. */
export function AppearanceChoiceRow<T extends string>({
    label,
    options,
    value,
    onUpdate,
    layout,
}: AppearanceChoiceRowProps<T>) {
    return (
        <div className={`appearance-choice appearance-choice_${layout}`}>
            <Text
                color={layout === 'stack' ? 'secondary' : undefined}
                className="appearance-choice__label"
            >
                {label}
            </Text>
            <SegmentedRadioGroup
                className="appearance-choice__picker"
                size="s"
                width={layout === 'stack' ? 'max' : undefined}
                options={options}
                value={value}
                onUpdate={onUpdate}
                aria-label={label}
            />
        </div>
    );
}

/** A colored dot + label for the accent options, so the picker reads as a color picker. */
export function accentContent(color: AccentColor, label: string): ReactNode {
    return (
        <span className="appearance-accent">
            <span className={`appearance-accent__dot appearance-accent__dot_${color}`} />
            {label}
        </span>
    );
}

export const FONT_OPTIONS: {value: EditorFont; content: string}[] = [
    {value: 'sans', content: 'Sans'},
    {value: 'serif', content: 'Serif'},
    {value: 'mono', content: 'Mono'},
];

export const ACCENT_OPTIONS: {value: AccentColor; content: ReactNode}[] = [
    {value: 'amber', content: accentContent('amber', 'Amber')},
    {value: 'blue', content: accentContent('blue', 'Blue')},
    {value: 'gray', content: accentContent('gray', 'Gray')},
];

export const WIDTH_OPTIONS: {value: TextWidth; content: string}[] = [
    {value: 'narrow', content: 'Narrow'},
    {value: 'normal', content: 'Normal'},
    {value: 'wide', content: 'Wide'},
    {value: 'unlimited', content: 'No limit'},
];

const DEFAULT_OPTION = {value: 'default' as const, content: 'Default'};

export const FONT_OPTIONS_WS: {value: EditorFontPref; content: ReactNode}[] = [
    DEFAULT_OPTION,
    ...FONT_OPTIONS,
];

export const ACCENT_OPTIONS_WS: {value: AccentColorPref; content: ReactNode}[] = [
    DEFAULT_OPTION,
    ...ACCENT_OPTIONS,
];

export const WIDTH_OPTIONS_WS: {value: TextWidthPref; content: ReactNode}[] = [
    DEFAULT_OPTION,
    ...WIDTH_OPTIONS,
];
