import {forwardRef} from 'react';
import type {ButtonHTMLAttributes, ReactNode} from 'react';

import './Button.css';

export type ButtonVariant = 'quiet' | 'raised' | 'filled';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    variant?: ButtonVariant;
    size?: 's' | 'm' | 'l';
    /** Leading 15px glyph. With no `children` the button becomes a square icon target. */
    icon?: ReactNode;
    children?: ReactNode;
    /** Sticky on/off state (a pane toggle). Rendered as `aria-pressed`, so it is announced too. */
    pressed?: boolean;
}

/**
 * Base UI ships no Button, and it is right not to: a button is one `<button>` and three rules of
 * CSS. See Button.css for what each variant is FOR — in particular, `filled` appears exactly once in
 * the whole app, which is the point of it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {variant = 'quiet', size = 'm', icon, children, pressed, className, type, ...rest},
    ref,
) {
    const iconOnly = Boolean(icon) && children === undefined;
    return (
        <button
            {...rest}
            ref={ref}
            type={type ?? 'button'}
            aria-pressed={pressed}
            className={[
                'ui-button',
                `ui-button_${variant}`,
                `ui-button_size-${size}`,
                iconOnly ? 'ui-button_icon' : '',
                className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            {icon ? <span className="ui-button__icon">{icon}</span> : null}
            {children}
        </button>
    );
});
