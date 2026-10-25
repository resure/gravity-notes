import type {ReactNode} from 'react';

import './bits.css';

/**
 * The four things §11 says stop being components once GravityUI is gone: a keycap, a chip, a
 * banner, and a skeleton row. Each is a tag and a handful of tokens; they live together because
 * separately they would be four files of five lines.
 */

/**
 * A keycap. The platform substitution that decides whether this says ⌘ or Ctrl lives in
 *  `src/shortcuts.ts` — that logic is the only part of GravityUI's Hotkey worth porting.
 */
export function Kbd({children}: {children: ReactNode}) {
    return <kbd className="ui-kbd">{children}</kbd>;
}

export interface ChipProps {
    icon?: ReactNode;
    children: ReactNode;
    /** Turns the chip into a button (the folder-scope chip opens the rail). */
    onClick?: () => void;
    /** Adds a ✕ that clears whatever the chip names. */
    onDismiss?: () => void;
    dismissLabel?: string;
    title?: string;
    className?: string;
}

/** 18px tall, 4px radius, `--text-3` — the folder-scope chip, and nothing else so far. */
export function Chip({
    icon,
    children,
    onClick,
    onDismiss,
    dismissLabel = 'Clear',
    title,
    className,
}: ChipProps) {
    const Tag = onClick ? 'button' : 'span';
    return (
        <span className={`ui-chip${className ? ` ${className}` : ''}`} title={title}>
            <Tag type={onClick ? 'button' : undefined} className="ui-chip__body" onClick={onClick}>
                {icon ? <span className="ui-chip__icon">{icon}</span> : null}
                <span className="ui-chip__label">{children}</span>
            </Tag>
            {onDismiss ? (
                <button
                    type="button"
                    className="ui-chip__dismiss"
                    aria-label={dismissLabel}
                    onClick={onDismiss}
                >
                    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                        <path
                            d="M1 1l6 6M7 1L1 7"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            ) : null}
        </span>
    );
}

export interface BannerProps {
    tone: 'info' | 'warning' | 'danger';
    title: ReactNode;
    children?: ReactNode;
    /** Trailing actions — a banner offers a way out, it is never merely an announcement. */
    actions?: ReactNode;
}

/**
 * One layout, three tones, and NOT dismissible on its own (§09): the sync-conflict banner describes
 * a state of the file on disk, so the only way to close it is to resolve that state.
 */
export function Banner({tone, title, children, actions}: BannerProps) {
    return (
        <div className={`ui-banner ui-banner_${tone}`} role="alert">
            <div className="ui-banner__text">
                <div className="ui-banner__title">{title}</div>
                {children ? <div className="ui-banner__body">{children}</div> : null}
            </div>
            {actions ? <div className="ui-banner__actions">{actions}</div> : null}
        </div>
    );
}

/**
 * A skeleton row — what the list shows instead of a spinner. §09: no spinner under 400ms, and the
 *  only spinner left in the app is the attachment upload.
 */
export function Skeleton({width, className}: {width?: number | string; className?: string}) {
    return (
        <span
            className={`ui-skeleton${className ? ` ${className}` : ''}`}
            style={width ? {width} : undefined}
            aria-hidden="true"
        />
    );
}
