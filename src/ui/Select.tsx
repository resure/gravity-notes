import type {ReactNode} from 'react';

import {Select as BaseSelect} from '@base-ui/react/select';

import {Check, ChevronDown} from './icons';

import './Select.css';
import './popup.css';

export interface SelectOption<T extends string> {
    value: T;
    label: string;
    /** Trailing note on the row (rarely used; the sort control has none). */
    hint?: ReactNode;
}

export interface SelectProps<T extends string> {
    options: readonly SelectOption<T>[];
    value: T;
    onChange: (value: T) => void;
    'aria-label': string;
    className?: string;
}

/**
 * The quiet Select — today the note list's sort control.
 *
 * §07's rule for it is entirely about restraint: the trigger is a text button with a chevron and no
 * field chrome until hover, and every row reserves the check column so nothing shifts when the
 * choice changes. `alignItemWithTrigger` is off deliberately: the native-macOS behaviour of
 * overlaying the popup so the selected row lands on the trigger fights a 24px trigger sitting in a
 * 38px header, and Base UI's default would otherwise cover the list header it belongs to.
 */
export function Select<T extends string>({
    options,
    value,
    onChange,
    'aria-label': ariaLabel,
    className,
}: SelectProps<T>) {
    const active = options.find((option) => option.value === value);
    return (
        <BaseSelect.Root
            value={value}
            onValueChange={(next) => {
                if (next) onChange(next as T);
            }}
        >
            <BaseSelect.Trigger
                className={`ui-select__trigger${className ? ` ${className}` : ''}`}
                aria-label={ariaLabel}
            >
                <BaseSelect.Value>{active?.label ?? ''}</BaseSelect.Value>
                <BaseSelect.Icon className="ui-select__chevron">
                    <ChevronDown size={12} />
                </BaseSelect.Icon>
            </BaseSelect.Trigger>
            <BaseSelect.Portal>
                <BaseSelect.Positioner
                    className="ui-pop-positioner"
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    alignItemWithTrigger={false}
                    collisionPadding={8}
                >
                    <BaseSelect.Popup className="ui-pop ui-pop_select">
                        {options.map((option) => (
                            <BaseSelect.Item
                                key={option.value}
                                value={option.value}
                                className="ui-pop__item"
                            >
                                <span className="ui-pop__icon ui-pop__icon_empty">
                                    <BaseSelect.ItemIndicator>
                                        <Check size={16} />
                                    </BaseSelect.ItemIndicator>
                                </span>
                                <BaseSelect.ItemText className="ui-pop__label">
                                    {option.label}
                                </BaseSelect.ItemText>
                                {option.hint ? (
                                    <span className="ui-pop__hint">{option.hint}</span>
                                ) : null}
                            </BaseSelect.Item>
                        ))}
                    </BaseSelect.Popup>
                </BaseSelect.Positioner>
            </BaseSelect.Portal>
        </BaseSelect.Root>
    );
}
