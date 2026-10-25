import {Progress as BaseProgress} from '@base-ui/react/progress';

import './Progress.css';

export interface ProgressProps {
    /** 0–100, or `null` for indeterminate ("something is happening, length unknown"). */
    value: number | null;
    'aria-label': string;
    className?: string;
}

/**
 * The progress bar — the software update's download, and the indeterminate sweep that stands in for
 * a spinner while the updater is checking or installing.
 *
 * §09 leaves exactly one spinner in the app (the attachment upload); everything else that waits
 * either shows skeleton rows or this. A bar says the same thing a spinner does and says it in the
 * shape of the thing it's measuring.
 */
export function Progress({value, 'aria-label': ariaLabel, className}: ProgressProps) {
    return (
        <BaseProgress.Root
            value={value}
            className={`ui-progress${className ? ` ${className}` : ''}`}
        >
            <BaseProgress.Track className="ui-progress__track">
                <BaseProgress.Indicator className="ui-progress__bar" />
            </BaseProgress.Track>
            <BaseProgress.Label className="ui-progress__label">{ariaLabel}</BaseProgress.Label>
        </BaseProgress.Root>
    );
}
