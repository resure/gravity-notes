import {useEffect, useState} from 'react';

import {Dialog} from '@gravity-ui/uikit';

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
        <Dialog
            open={open}
            onClose={onClose}
            aria-label="About Gravity Notes"
            className="about-dialog"
            hasCloseButton={false}
        >
            <Dialog.Body>
                <div className="about">
                    <div className="about__orb" aria-hidden />
                    <div className="about__name">Gravity Notes</div>
                    {version ? <div className="about__version">Version {version}</div> : null}
                    <div className="about__links">
                        <a className="about__link" href={GITHUB_URL} onClick={openLink(GITHUB_URL)}>
                            Project on GitHub
                        </a>
                        <a
                            className="about__link"
                            href={GRAVITY_URL}
                            onClick={openLink(GRAVITY_URL)}
                        >
                            Powered by GravityUI
                        </a>
                    </div>
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
