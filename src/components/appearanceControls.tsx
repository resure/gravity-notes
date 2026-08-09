import type {ReactNode} from 'react';

import {Label, SegmentedRadioGroup, Text} from '@gravity-ui/uikit';

import {
    EDITOR_FONTS,
    type EditorFont,
    type EditorFontPref,
    TEXT_WIDTHS,
    type TextWidth,
    type TextWidthPref,
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
    /** Tag the row as experimental, like `ToggleRow` in the Settings dialog. */
    experimental?: boolean;
}

/** One appearance picker: a label + segmented control, in the layout its host needs. */
export function AppearanceChoiceRow<T extends string>({
    label,
    options,
    value,
    onUpdate,
    layout,
    experimental,
}: AppearanceChoiceRowProps<T>) {
    return (
        <div className={`appearance-choice appearance-choice_${layout}`}>
            <Text
                color={layout === 'stack' ? 'secondary' : undefined}
                className="appearance-choice__label"
            >
                {label}
                {experimental ? (
                    <Label theme="info" size="xs">
                        Experimental
                    </Label>
                ) : null}
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

/**
 * Labels keyed by the full union (`Record` exhaustiveness), and options DERIVED from the canonical
 * value arrays — the same arrays `oneOf` validates persisted values against. A new union member
 * fails typecheck here until it's labeled, and then appears in every picker automatically; the
 * pickers can never silently offer less than storage accepts.
 */
const FONT_LABELS: Record<EditorFont, string> = {sans: 'Sans', serif: 'Serif', mono: 'Mono'};
const WIDTH_LABELS: Record<TextWidth, string> = {
    narrow: 'Narrow',
    normal: 'Normal',
    wide: 'Wide',
    unlimited: 'No limit',
};

export const FONT_OPTIONS: {value: EditorFont; content: string}[] = EDITOR_FONTS.map((value) => ({
    value,
    content: FONT_LABELS[value],
}));

export const WIDTH_OPTIONS: {value: TextWidth; content: string}[] = TEXT_WIDTHS.map((value) => ({
    value,
    content: WIDTH_LABELS[value],
}));

const DEFAULT_OPTION = {value: 'default' as const, content: 'Default'};

export const FONT_OPTIONS_WS: {value: EditorFontPref; content: ReactNode}[] = [
    DEFAULT_OPTION,
    ...FONT_OPTIONS,
];

export const WIDTH_OPTIONS_WS: {value: TextWidthPref; content: ReactNode}[] = [
    DEFAULT_OPTION,
    ...WIDTH_OPTIONS,
];
