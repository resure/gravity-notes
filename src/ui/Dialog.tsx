import {useRef} from 'react';
import type {ReactNode, RefObject} from 'react';

import {AlertDialog as BaseAlertDialog} from '@base-ui/react/alert-dialog';
import {Dialog as BaseDialog} from '@base-ui/react/dialog';

import {Button} from './Button';

import './Dialog.css';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    /** Dialog width in px — §08's Settings is 620; pickers are narrower. */
    width?: number;
    /**
     * What takes focus when the dialog opens. Both filter-first dialogs (Move to…, the workspace
     * switcher) need this: their listbox model reads keys at the document level, so the caret has
     * to start in the filter field rather than on the popup container.
     */
    initialFocus?: RefObject<HTMLElement | null>;
    footer?: ReactNode;
    className?: string;
    children: ReactNode;
}

/**
 * A dialog. Base UI renders `role="dialog"` and — critically — UNMOUNTS the popup on close by
 * default: `useShortcuts` suppresses every global chord while `[role="dialog"]` matches in the
 * document, so a `keepMounted` dialog would silently kill ⌘N, ⌘L and the rest for the rest of the
 * session. Never pass `keepMounted` here.
 *
 * Scroll lock is Base UI's too — the hand-rolled `disableBodyScrollLock` workarounds the old dialogs
 * carried are gone with them.
 */
export function Dialog({
    open,
    onClose,
    title,
    width,
    initialFocus,
    footer,
    className,
    children,
}: DialogProps) {
    return (
        <BaseDialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <BaseDialog.Portal>
                <BaseDialog.Backdrop className="ui-dialog-backdrop" />
                <BaseDialog.Popup
                    className={`ui-dialog${className ? ` ${className}` : ''}`}
                    style={width ? ({'--ui-dialog-width': `${width}px`} as never) : undefined}
                    initialFocus={initialFocus}
                >
                    <BaseDialog.Title className="ui-dialog__title">{title}</BaseDialog.Title>
                    <div className="ui-dialog__body">{children}</div>
                    {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
                </BaseDialog.Popup>
            </BaseDialog.Portal>
        </BaseDialog.Root>
    );
}

export interface AlertDialogProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    children: ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
    cancelLabel?: string;
    /** The confirm button carries the destructive weight (delete / move to trash). */
    danger?: boolean;
    width?: number;
}

/**
 * The confirm. An AlertDialog rather than a Dialog because it is a question with consequences:
 * Base UI keeps it out of the light-dismiss path, so a stray click on the scrim can't answer it.
 */
export function AlertDialog({
    open,
    onClose,
    title,
    children,
    confirmLabel,
    onConfirm,
    cancelLabel = 'Cancel',
    danger,
    width = 400,
}: AlertDialogProps) {
    // The confirm button takes focus, so ⏎ answers the question the dialog asked. That is the
    // behaviour the app has always had (the old dialog bound Enter to apply) and it is what makes
    // "⌘⇧⌫ ⏎" a fluent way to trash a note; Esc and the scrim still cancel.
    const confirmRef = useRef<HTMLButtonElement>(null);
    return (
        <BaseAlertDialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <BaseAlertDialog.Portal>
                <BaseAlertDialog.Backdrop className="ui-dialog-backdrop" />
                <BaseAlertDialog.Popup
                    className="ui-dialog"
                    style={{'--ui-dialog-width': `${width}px`} as never}
                    initialFocus={confirmRef}
                >
                    <BaseAlertDialog.Title className="ui-dialog__title">
                        {title}
                    </BaseAlertDialog.Title>
                    <BaseAlertDialog.Description className="ui-dialog__body">
                        {children}
                    </BaseAlertDialog.Description>
                    <div className="ui-dialog__footer">
                        <Button size="l" onClick={onClose}>
                            {cancelLabel}
                        </Button>
                        <Button
                            ref={confirmRef}
                            size="l"
                            variant={danger ? 'filled' : 'raised'}
                            className={danger ? 'ui-button_danger' : undefined}
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </BaseAlertDialog.Popup>
            </BaseAlertDialog.Portal>
        </BaseAlertDialog.Root>
    );
}
