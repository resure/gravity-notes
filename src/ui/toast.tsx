import type {ReactNode} from 'react';

import {Toast as BaseToast} from '@base-ui/react/toast';

import {Xmark} from './icons';

import './toast.css';

/**
 * Toasts, for genuine failures only.
 *
 * The redesign deletes the save confirmation entirely: a toast on every autosave is a notification
 * about the thing you are already doing, and §04's sync dot carries that state in the title bar
 * instead. What is left here fires when something went wrong, or when there is an action to take
 * (an update is ready) — both worth interrupting for.
 *
 * The manager is module-level and imperative on purpose. Every call site is a callback deep inside
 * async work (a save that failed, an import that threw), and threading a hook's `add` through them
 * is what made the old code pass `add` down as a dependency of half its `useCallback`s.
 */
const manager = BaseToast.createToastManager<ToastData>();

interface ToastData extends Record<string, unknown> {
    actions?: {label: string; onClick: () => void}[];
}

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastOptions {
    title: string;
    content?: ReactNode;
    tone?: ToastTone;
    /** ms before auto-dismiss; `false` keeps it up until acted on or closed. */
    timeout?: number | false;
    actions?: {label: string; onClick: () => void}[];
}

export function toast({title, content, tone = 'info', timeout = 5000, actions}: ToastOptions) {
    return manager.add({
        title,
        description: content,
        type: tone,
        timeout: timeout === false ? 0 : timeout,
        priority: tone === 'danger' ? 'high' : 'low',
        data: {actions},
    });
}

function ToastList() {
    const {toasts} = BaseToast.useToastManager<ToastData>();
    return (
        <>
            {toasts.map((item) => (
                <BaseToast.Root key={item.id} toast={item} className="ui-toast">
                    <BaseToast.Title className="ui-toast__title" />
                    <BaseToast.Description className="ui-toast__content" />
                    {item.data?.actions?.length ? (
                        <div className="ui-toast__actions">
                            {item.data.actions.map((action) => (
                                <button
                                    key={action.label}
                                    type="button"
                                    className="ui-toast__action"
                                    onClick={() => {
                                        action.onClick();
                                        manager.close(item.id);
                                    }}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <BaseToast.Close className="ui-toast__close" aria-label="Close">
                        <Xmark size={12} />
                    </BaseToast.Close>
                </BaseToast.Root>
            ))}
        </>
    );
}

/** Mount once at the app root: the provider plus the viewport the toasts stack into. */
export function ToastRegion({children}: {children: ReactNode}) {
    return (
        <BaseToast.Provider toastManager={manager}>
            {children}
            <BaseToast.Portal>
                <BaseToast.Viewport className="ui-toast-viewport">
                    <ToastList />
                </BaseToast.Viewport>
            </BaseToast.Portal>
        </BaseToast.Provider>
    );
}
