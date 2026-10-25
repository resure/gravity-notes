import type {ReactNode} from 'react';

import {Toggle} from '@base-ui/react/toggle';
import {ToggleGroup as BaseToggleGroup} from '@base-ui/react/toggle-group';

import './controls.css';

export interface ToggleGroupOption<T extends string> {
    value: T;
    content: ReactNode;
    /** Overrides the accessible name when `content` is a glyph or a styled sample. */
    label?: string;
}

export interface ToggleGroupProps<T extends string> {
    options: readonly ToggleGroupOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Names the group for assistive tech; every strip in the app sits beside a visible label. */
    'aria-label': string;
    className?: string;
}

/**
 * The segmented control, everywhere — appearance strips in the note menu and in Settings.
 *
 * Base UI's ToggleGroup is multi-select-capable and reports an ARRAY. The app has no multi-select
 * strip, and a single-select strip must never land on "nothing selected", so this wrapper pins it
 * to one value: a click on the already-pressed segment is ignored rather than clearing it.
 */
export function ToggleGroup<T extends string>({
    options,
    value,
    onChange,
    'aria-label': ariaLabel,
    className,
}: ToggleGroupProps<T>) {
    return (
        <BaseToggleGroup
            className={`ui-toggle-group${className ? ` ${className}` : ''}`}
            aria-label={ariaLabel}
            value={[value]}
            onValueChange={(next) => {
                const picked = next.find((v) => v !== value);
                if (picked) onChange(picked as T);
            }}
        >
            {options.map((option) => (
                <Toggle
                    key={option.value}
                    className="ui-toggle-group__item"
                    value={option.value}
                    aria-label={option.label}
                >
                    {option.content}
                </Toggle>
            ))}
        </BaseToggleGroup>
    );
}
