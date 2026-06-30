import {useEffect, useState} from 'react';

import {Dialog, Link, Text} from '@gravity-ui/uikit';

import {isTauri} from '../isTauri';
import {openExternalUrl} from '../openExternal';

import './AboutDialog.css';

const GITHUB_URL = 'https://github.com/resure/gravity-notes';
const GRAVITY_URL = 'https://gravity-ui.com';

/**
 * The app's About box, opened from the native macOS "About Gravity Notes" menu item (Workspace
 * listens for the `menu:about` event the Rust menu handler emits). We render our own dialog rather
 * than the OS panel because the native panel can't show clickable links — Tauri/muda renders its
 * credits as plain text. Links route through {@link openExternalUrl} (the OS browser on desktop,
 * a new tab on web), since WKWebView won't navigate to external origins on its own.
 */
export function AboutDialog({open, onClose}: {open: boolean; onClose: () => void}) {
    const [version, setVersion] = useState<string | null>(null);

    // Read the running app version from the shell (desktop only); skipped on web, where there's no
    // native version to report. Loaded via dynamic import() so the Tauri API never enters the web bundle.
    useEffect(() => {
        if (!open || !isTauri) return undefined;
        let alive = true;
        void import('@tauri-apps/api/app').then(({getVersion}) =>
            getVersion()
                .then((v) => {
                    if (alive) setVersion(v);
                })
                .catch(() => {}),
        );
        return () => {
            alive = false;
        };
    }, [open]);

    const openLink = (url: string) => (event: React.MouseEvent) => {
        event.preventDefault();
        openExternalUrl(url);
    };

    return (
        <Dialog open={open} onClose={onClose} size="s">
            <Dialog.Body>
                <div className="about-dialog">
                    <div className="about-dialog__orb" aria-hidden />
                    <Text variant="subheader-2">Gravity Notes</Text>
                    {version ? (
                        <Text color="secondary" variant="body-1">
                            Version {version}
                        </Text>
                    ) : null}
                    <div className="about-dialog__links">
                        <Link href={GITHUB_URL} onClick={openLink(GITHUB_URL)}>
                            Project on GitHub
                        </Link>
                        <Link href={GRAVITY_URL} onClick={openLink(GRAVITY_URL)}>
                            Powered by GravityUI
                        </Link>
                    </div>
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
