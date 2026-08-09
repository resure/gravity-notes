import {useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';

import {OverlayPortal} from './OverlayPortal';
import {toggleInlineCode} from './caret';
import {LinkIcon} from './icons';

interface ToolbarProps {
    rootRef: RefObject<HTMLDivElement | null>;
    onSync: (blockId: string, html: string) => void;
    linkRequest: number;
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

export default function SelectionToolbar({rootRef, onSync, linkRequest}: ToolbarProps) {
    const [state, setState] = useState<ToolbarState | null>(null);
    const [active, setActive] = useState<Record<string, boolean>>({});
    const [linkMode, setLinkMode] = useState(false);
    const [linkValue, setLinkValue] = useState('');
    const barRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const mouseIsDown = useRef(false);
    const linkModeRef = useRef(false);
    linkModeRef.current = linkMode;

    useEffect(() => {
        const update = () => {
            if (linkModeRef.current) return;
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
        return () => {
            document.removeEventListener('selectionchange', update);
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [rootRef]);

    useEffect(() => {
        if (!linkRequest) return;
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

    if (!state) return null;

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
                {linkMode ? (
                    <input
                        className="tb-link-input"
                        autoFocus
                        placeholder="Paste link"
                        aria-label="Link URL"
                        value={linkValue}
                        onChange={(e) => setLinkValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') applyLink();
                            if (e.key === 'Escape') cancelLink();
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
                        {btn('link', <LinkIcon />, openLinkEditor, 'Link')}
                    </>
                )}
            </div>
        </OverlayPortal>
    );
}
