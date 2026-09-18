import {useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';

import {colorClassFor, colorFromClass} from '../../markdown/color';

import {OverlayPortal} from './OverlayPortal';
import {BACKGROUND_COLORS_AT, COLOR_OPTIONS} from './blockColors';
import {toggleInlineCode} from './caret';
import {LinkIcon} from './icons';
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
}

interface ToolbarState {
    x: number;
    y: number;
}

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

export default function SelectionToolbar({rootRef, onSync, linkRequest, hidden}: ToolbarProps) {
    const [state, setState] = useState<ToolbarState | null>(null);
    const [active, setActive] = useState<Record<string, boolean>>({});
    const [linkMode, setLinkMode] = useState(false);
    const [colorMode, setColorMode] = useState(false);
    const [linkValue, setLinkValue] = useState('');
    const barRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const mouseIsDown = useRef(false);
    /** A panel (the link box, the palette) has the bar — re-measuring under one would close it. */
    const panelOpenRef = useRef(false);
    panelOpenRef.current = linkMode || colorMode;
    const hiddenRef = useRef(false);
    hiddenRef.current = Boolean(hidden);
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
            const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
            if (!rootRef.current) return;
            // VIEWPORT coordinates (the bar is position: fixed) — see the note on the component.
            setState({x: Math.max(8, rect.left), y: rect.top});
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
        document.addEventListener('selectionchange', update);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        // The bar is `position: fixed` over a selection rect measured when the selection changed.
        // Scrolling the pane moves the text out from under it, so re-measure — `update` already
        // reads the LIVE selection, so it needs no new logic. Captured: scroll does not bubble.
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            document.removeEventListener('selectionchange', update);
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
        setState({x: Math.max(8, rect.left), y: rect.top});
        setLinkValue(a?.getAttribute('href') ?? '');
        setLinkMode(true);
    }, [linkRequest]);

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

    const applyLink = () => {
        const sel = window.getSelection();
        if (sel && savedRange.current) {
            sel.removeAllRanges();
            sel.addRange(savedRange.current);
            const url = linkValue.trim();
            if (url === '') {
                document.execCommand('unlink');
            } else {
                const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
                document.execCommand('createLink', false, href);
            }
            syncSelectionBlock();
        }
        setLinkMode(false);
        setState(null);
    };

    /**
     * Colour the selected text — the inline half of the palette (the block menu colours a whole
     * block). The range is rebuilt rather than handed to `execCommand`: the browser's own
     * `foreColor` writes inline styles that the editor's sanitizer strips, and a background has no
     * command at all.
     *
     * Colours nest, and the innermost wins in both CSS and the file's `{red}({blue}(…))`. Default is
     * therefore the one case that has to REMOVE something, and it removes any colour the selection
     * touches, including one that started outside it — a colour you cannot see the end of is worse
     * than one that gives up more than you asked.
     */
    const applyColor = (color: BlockColor) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        const block = selectionContentEl();
        const range = sel.getRangeAt(0);
        if (color === 'default') {
            const ancestor = (
                range.commonAncestorContainer instanceof Element
                    ? range.commonAncestorContainer
                    : range.commonAncestorContainer.parentElement
            )?.closest('span');
            if (ancestor && colorFromClass(ancestor.className) && block?.contains(ancestor)) {
                ancestor.replaceWith(...ancestor.childNodes);
            }
        }
        const fragment = range.extractContents();
        for (const span of [...fragment.querySelectorAll('span')]) {
            if (colorFromClass(span.className)) span.replaceWith(...span.childNodes);
        }
        let inserted: Node = fragment;
        if (color !== 'default') {
            const span = document.createElement('span');
            span.className = colorClassFor(color);
            span.appendChild(fragment);
            inserted = span;
        }
        range.insertNode(inserted);
        sel.removeAllRanges();
        const restored = document.createRange();
        restored.selectNodeContents(inserted);
        sel.addRange(restored);
        syncSelectionBlock();
        setColorMode(false);
        setState(null);
    };

    const cancelLink = () => {
        const sel = window.getSelection();
        if (sel && savedRange.current) {
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
                style={{left: state.x, top: state.y}}
                role="toolbar"
                aria-label="Text formatting"
            >
                {colorMode ? (
                    <div className="tb-colors">
                        <div className="menu-section">Text color</div>
                        <div className="color-grid">
                            {COLOR_OPTIONS.slice(0, BACKGROUND_COLORS_AT).map((color) => (
                                <button
                                    type="button"
                                    key={color.value}
                                    className="color-swatch"
                                    title={color.label}
                                    aria-label={color.label}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyColor(color.value)}
                                >
                                    <span style={{color: color.swatch}}>A</span>
                                </button>
                            ))}
                        </div>
                        <div className="menu-section">Background color</div>
                        <div className="color-grid">
                            {COLOR_OPTIONS.slice(BACKGROUND_COLORS_AT).map((color) => (
                                <button
                                    type="button"
                                    key={color.value}
                                    className="color-swatch"
                                    title={color.label}
                                    aria-label={color.label}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyColor(color.value)}
                                >
                                    <span style={{background: color.swatch}}>A</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : linkMode ? (
                    <input
                        className="tb-link-input"
                        autoFocus
                        placeholder="Paste link"
                        aria-label="Link URL"
                        value={linkValue}
                        onChange={(e) => setLinkValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') applyLink();
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
