import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, RefObject} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {ColorPalette, colorSelection} from './blockColors';
import {toggleInlineCode} from './caret';
import {LinkIcon} from './icons';
import {subscribeSelectionFrame} from './selectionFrame';
import type {BlockColor} from './types';

interface ToolbarProps {
    rootRef: RefObject<HTMLDivElement | null>;
    onSync: (blockId: string, html: string) => void;
    linkRequest: number;
    /**
     * The editor is off screen (read-only preview is showing over it). A PROP rather than the host
     * simply not rendering this: the bar portals to `<body>`, so it has to be told — and unmounting
     * it instead replayed the `linkRequest` effect below on the way back, popping the link box open
     * over a stale rect and stealing the caret.
     */
    hidden?: boolean;
    /** The sticky toolbar carries the buttons; only the link box (⌘K) still opens here. */
    linkOnly?: boolean;
}

/**
 * What a typed link points at. Only something shaped like a bare domain gets `https://`: a relative
 * path, an `Attachments/…` file or a `#heading` is already a link, and prefixing it broke it.
 */
export function linkHref(url: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(#|\/|\.{1,2}\/)/.test(url)) return url;
    return /^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(url) && !/^Attachments\//.test(url)
        ? `https://${url}`
        : url;
}

interface ToolbarState {
    x: number;
    y: number;
    bottom: number;
}

const VIEWPORT_MARGIN = 8;

function selectionContentEl(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    return (el?.closest('[data-block-id]') as HTMLElement | null) ?? null;
}

function computeActive(): Record<string, boolean> {
    const active: Record<string, boolean> = {};
    for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough']) {
        try {
            active[cmd] = document.queryCommandState(cmd);
        } catch {
            active[cmd] = false;
        }
    }
    const sel = window.getSelection();
    const node = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).commonAncestorContainer : null;
    const el = node instanceof Element ? node : node?.parentElement;
    active.code = Boolean(el?.closest('code'));
    active.link = Boolean(el?.closest('a'));
    return active;
}

export default function SelectionToolbar({
    rootRef,
    onSync,
    linkRequest,
    hidden,
    linkOnly = false,
}: ToolbarProps) {
    const [state, setState] = useState<ToolbarState | null>(null);
    const [active, setActive] = useState<Record<string, boolean>>({});
    const [linkMode, setLinkMode] = useState(false);
    const [colorMode, setColorMode] = useState(false);
    const [linkValue, setLinkValue] = useState('');
    const [placement, setPlacement] = useState<CSSProperties | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const mouseIsDown = useRef(false);
    /** A panel (the link box, the palette) has the bar — re-measuring under one would close it. */
    const panelOpenRef = useRef(false);
    panelOpenRef.current = linkMode || colorMode;
    const hiddenRef = useRef(false);
    hiddenRef.current = Boolean(hidden) || linkOnly;
    /** The counter's value at mount, so a remount cannot replay the last ⌘K as a fresh one. */
    const seenLinkRequest = useRef(linkRequest);

    useEffect(() => {
        const update = () => {
            if (panelOpenRef.current || hiddenRef.current) return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                setState(null);
                return;
            }
            const el = selectionContentEl();
            if (!el || el.dataset.blockType === 'code') {
                setState(null);
                return;
            }
            if (mouseIsDown.current) return;
            const range = sel.getRangeAt(0);
            const rects = range.getClientRects();
            const bounds = range.getBoundingClientRect();
            const rect = rects.length > 0 ? rects[0] : bounds;
            if (!rootRef.current) return;
            // VIEWPORT coordinates (the bar is position: fixed) — see the note on the component.
            setState({x: Math.max(8, rect.left), y: rect.top, bottom: bounds.bottom});
            setActive(computeActive());
        };
        const onMouseDown = (e: globalThis.MouseEvent) => {
            if (barRef.current?.contains(e.target as Node)) return;
            mouseIsDown.current = true;
        };
        const onMouseUp = () => {
            mouseIsDown.current = false;
            // Let the browser settle the selection first.
            setTimeout(update, 0);
        };
        const unsubscribe = subscribeSelectionFrame(update);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        // The bar is `position: fixed` over a selection rect measured when the selection changed.
        // Scrolling the pane moves the text out from under it, so re-measure — `update` already
        // reads the LIVE selection, so it needs no new logic. Captured: scroll does not bubble.
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            unsubscribe();
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [rootRef]);

    /**
     * Going off screen puts the bar away for good, link editor included.
     *
     * Not merely hiding it: `linkMode` and the anchor rect would then still be set on the way back,
     * so ⌘K → preview → back re-opened the "Paste link" box over a rect measured before the toggle
     * and took the caret with it (`autoFocus`), which is the very thing being off screen has to
     * prevent. `update()` cannot do this — it returns early while the link editor is open, by
     * design, so that typing a URL does not dismiss the box the URL is being typed into.
     */
    useEffect(() => {
        if (!hidden) return;
        setLinkMode(false);
        setColorMode(false);
        setState(null);
        savedRange.current = null;
    }, [hidden]);

    useEffect(() => {
        if (linkRequest === seenLinkRequest.current) return;
        seenLinkRequest.current = linkRequest;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        savedRange.current = sel.getRangeAt(0).cloneRange();
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const el = node instanceof Element ? node : node.parentElement;
        const a = el?.closest('a');
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setState({x: Math.max(8, rect.left), y: rect.top, bottom: rect.bottom});
        setLinkValue(a?.getAttribute('href') ?? '');
        setLinkMode(true);
    }, [linkRequest]);

    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar || !state) {
            setPlacement(null);
            return;
        }
        const left = Math.max(
            VIEWPORT_MARGIN,
            Math.min(state.x, window.innerWidth - bar.offsetWidth - VIEWPORT_MARGIN),
        );
        const fitsAbove = state.y - bar.offsetHeight - VIEWPORT_MARGIN >= VIEWPORT_MARGIN;
        setPlacement(
            fitsAbove
                ? {left, top: state.y}
                : {left, top: state.bottom + VIEWPORT_MARGIN, transform: 'none'},
        );
    }, [state, colorMode, linkMode, hidden]);

    if (hidden || !state) return null;

    const syncSelectionBlock = () => {
        const el = selectionContentEl();
        if (el?.dataset.blockId) onSync(el.dataset.blockId, el.innerHTML);
    };

    const exec = (command: string) => {
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand(command);
        syncSelectionBlock();
        setActive(computeActive());
    };

    const execCode = () => {
        toggleInlineCode();
        syncSelectionBlock();
        setActive(computeActive());
    };

    const openLinkEditor = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        savedRange.current = sel.getRangeAt(0).cloneRange();
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const el = node instanceof Element ? node : node.parentElement;
        const a = el?.closest('a');
        setLinkValue(a?.getAttribute('href') ?? '');
        setLinkMode(true);
    };

    // The link box holds focus while it is open; the text it links has to have it back before the
    // command runs, or the command edits the box instead.
    const refocusText = (range: Range) => {
        const container = range.commonAncestorContainer;
        (container instanceof Element ? container : container.parentElement)
            ?.closest<HTMLElement>('[contenteditable="true"]')
            ?.focus();
    };

    const applyLink = () => {
        const sel = window.getSelection();
        if (sel && savedRange.current) {
            refocusText(savedRange.current);
            sel.removeAllRanges();
            sel.addRange(savedRange.current);
            const url = linkValue.trim();
            if (url === '') {
                document.execCommand('unlink');
            } else {
                const href = linkHref(url);
                document.execCommand('createLink', false, href);
            }
            syncSelectionBlock();
        }
        setLinkMode(false);
        setState(null);
    };

    const applyColor = (color: BlockColor) => {
        if (colorSelection(color, selectionContentEl())) syncSelectionBlock();
        setColorMode(false);
        setState(null);
    };

    const cancelLink = () => {
        const sel = window.getSelection();
        if (sel && savedRange.current) {
            refocusText(savedRange.current);
            sel.removeAllRanges();
            sel.addRange(savedRange.current);
        }
        setLinkMode(false);
    };

    const btn = (
        key: string,
        label: React.ReactNode,
        onClick: () => void,
        title: string,
        className = '',
    ) => (
        <button
            type="button"
            className={`tb-btn ${className}${active[key] ? ' active' : ''}`}
            title={title}
            aria-label={title}
            aria-pressed={active[key]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
        >
            {label}
        </button>
    );

    // Portaled to <body> — see SlashMenu for why (a transformed ancestor captures
    // `position: fixed`, and the pane clips its overflow).
    return (
        <OverlayPortal>
            <div
                ref={barRef}
                className="sel-toolbar"
                style={placement ?? {left: state.x, top: state.y, visibility: 'hidden'}}
                role="toolbar"
                aria-label="Text formatting"
            >
                {colorMode ? (
                    <div className="tb-colors">
                        <ColorPalette onPick={applyColor} />
                    </div>
                ) : linkMode ? (
                    <input
                        className="tb-link-input"
                        autoFocus
                        // An existing link's address comes selected, so typing replaces it.
                        onFocus={(e) => e.currentTarget.select()}
                        placeholder="Paste link"
                        aria-label="Link URL"
                        value={linkValue}
                        onChange={(e) => setLinkValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                // Or the keypress goes on to split the paragraph at the selection
                                // applyLink has just put back — replacing the linked words with a
                                // line break.
                                e.preventDefault();
                                applyLink();
                            }
                            if (e.key === 'Escape') {
                                // Mark it handled — EditorPane's Esc ladder skips a
                                // `defaultPrevented` Escape, so focus stays in the editor.
                                e.preventDefault();
                                cancelLink();
                            }
                        }}
                    />
                ) : (
                    <>
                        {btn('bold', 'B', () => exec('bold'), 'Bold (⌘B)', 'tb-b')}
                        {btn('italic', 'i', () => exec('italic'), 'Italic (⌘I)', 'tb-i')}
                        {btn('underline', 'U', () => exec('underline'), 'Underline (⌘U)', 'tb-u')}
                        {btn(
                            'strikeThrough',
                            'S',
                            () => exec('strikeThrough'),
                            'Strikethrough (⌘⇧S)',
                            'tb-s',
                        )}
                        {btn('code', '</>', execCode, 'Code (⌘E)', 'tb-code')}
                        <div className="tb-divider" />
                        {btn('color', 'A', () => setColorMode(true), 'Color', 'tb-color')}
                        {btn('link', <LinkIcon />, openLinkEditor, 'Link')}
                    </>
                )}
            </div>
        </OverlayPortal>
    );
}
