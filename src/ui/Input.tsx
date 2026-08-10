import {forwardRef} from 'react';
import type {InputHTMLAttributes, ReactNode} from 'react';

import {Xmark} from './icons';

import './controls.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    /** Leading glyph inside the field (the search box's magnifier). */
    icon?: ReactNode;
    /** Trailing content — a keycap hint, a count, anything that is not a control. */
    trailing?: ReactNode;
    /** Show a clear button while the field has a value. */
    onClear?: () => void;
    size?: 'm' | 'l';
    /** Class for the field shell (the input itself keeps its own). */
    className?: string;
}

/**
 * A field. Base UI's `Field` carries label/error wiring the app has no use for yet — every field
 * here is named by `aria-label` and validated by what it does, not by a message — so this is a
 * plain input in the §04 field shell. The shell owns the focus ring: the ring belongs around the
 * whole box, not inside it.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    {icon, trailing, onClear, size = 'm', className, ...rest},
    ref,
) {
    return (
        // A `<label>`, not a div: the shell is the field's own padding, its magnifier and its
        // keycap, and a click on any of them should land in the input. A label does that natively —
        // no handler, no role, nothing to keep in sync.
        <label className={`ui-field ui-field_size-${size}${className ? ` ${className}` : ''}`}>
            {icon ? <span className="ui-field__icon">{icon}</span> : null}
            <input {...rest} ref={ref} className="ui-field__input" />
            {onClear && rest.value ? (
                <button
                    type="button"
                    className="ui-field__clear"
                    aria-label="Clear"
                    onClick={onClear}
                >
                    <Xmark size={12} />
                </button>
            ) : null}
            {trailing}
        </label>
    );
});
