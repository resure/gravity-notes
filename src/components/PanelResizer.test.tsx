import {useState} from 'react';

import {fireEvent, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    PanelResizer,
    clampPanelWidth,
    parsePanelWidth,
} from './PanelResizer';

const handlers = () => ({
    onResize: vi.fn(),
    onCommit: vi.fn(),
    onReset: vi.fn(),
});

const renderResizer = (props: Partial<Parameters<typeof PanelResizer>[0]> = {}) => {
    const h = handlers();
    const {unmount} = renderWithProviders(
        <PanelResizer label="Resize note list" width={280} {...h} {...props} />,
    );
    return {divider: screen.getByRole('separator', {name: 'Resize note list'}), unmount, ...h};
};

describe('clampPanelWidth', () => {
    it('clamps into the shared range', () => {
        expect(clampPanelWidth(PANEL_MIN_WIDTH - 100)).toBe(PANEL_MIN_WIDTH);
        expect(clampPanelWidth(PANEL_MAX_WIDTH + 100)).toBe(PANEL_MAX_WIDTH);
        expect(clampPanelWidth(300)).toBe(300);
    });

    it('tightens to a gesture cap, but the cap never wins below the minimum', () => {
        expect(clampPanelWidth(400, 320)).toBe(320);
        // A tiny window must not wedge the divider into an undraggable dead state.
        expect(clampPanelWidth(400, PANEL_MIN_WIDTH - 50)).toBe(PANEL_MIN_WIDTH);
    });
});

describe('parsePanelWidth', () => {
    it('parses a stored width, clamping and rounding', () => {
        expect(parsePanelWidth('300')).toBe(300);
        expect(parsePanelWidth('300.6')).toBe(301);
        expect(parsePanelWidth(String(PANEL_MAX_WIDTH + 500))).toBe(PANEL_MAX_WIDTH);
        expect(parsePanelWidth('1')).toBe(PANEL_MIN_WIDTH);
    });

    it('treats missing or garbage values as "use the default"', () => {
        expect(parsePanelWidth(null)).toBeNull();
        expect(parsePanelWidth('')).toBeNull();
        expect(parsePanelWidth('wide')).toBeNull();
        expect(parsePanelWidth('NaN')).toBeNull();
        expect(parsePanelWidth('Infinity')).toBeNull();
    });
});

describe('PanelResizer', () => {
    it('is an accessible vertical separator reporting its width', () => {
        const {divider} = renderResizer();
        expect(divider).toHaveAttribute('aria-orientation', 'vertical');
        expect(divider).toHaveAttribute('aria-valuemin', String(PANEL_MIN_WIDTH));
        expect(divider).toHaveAttribute('aria-valuemax', String(PANEL_MAX_WIDTH));
        expect(divider).toHaveAttribute('aria-valuenow', '280');
    });

    it('drags: live onResize per move, one onCommit on release', () => {
        const {divider, onResize, onCommit} = renderResizer();
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 140, pointerId: 1});
        expect(onResize).toHaveBeenLastCalledWith(320);
        fireEvent.pointerMove(divider, {clientX: 120, pointerId: 1});
        expect(onResize).toHaveBeenLastCalledWith(300);
        expect(onCommit).not.toHaveBeenCalled();
        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(300);
    });

    it('clamps a drag to the range and to the gesture cap from getMaxWidth', () => {
        const {divider, onResize} = renderResizer({getMaxWidth: () => 310});
        fireEvent.pointerDown(divider, {button: 0, clientX: 0, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 500, pointerId: 1});
        expect(onResize).toHaveBeenLastCalledWith(310);
        fireEvent.pointerMove(divider, {clientX: -500, pointerId: 1});
        expect(onResize).toHaveBeenLastCalledWith(PANEL_MIN_WIDTH);
    });

    it('ignores moves with no drag in progress and non-primary buttons', () => {
        const {divider, onResize, onCommit} = renderResizer();
        fireEvent.pointerMove(divider, {clientX: 400, pointerId: 1});
        fireEvent.pointerDown(divider, {button: 2, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 400, pointerId: 1});
        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(onResize).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('resets on double-click', () => {
        const {divider, onReset} = renderResizer();
        fireEvent.doubleClick(divider);
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('cancels the native pointerdown (WebKit selection start, focus steal)', () => {
        const {divider} = renderResizer();
        // fireEvent returns false when a handler called preventDefault.
        expect(fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1})).toBe(false);
        // Non-primary buttons pass through untouched.
        expect(fireEvent.pointerDown(divider, {button: 2, clientX: 100, pointerId: 2})).toBe(true);
    });

    it('resizes from the keyboard: arrows step, Home/End jump, all clamped', () => {
        const {divider, onCommit} = renderResizer({getMaxWidth: () => 400});
        fireEvent.keyDown(divider, {key: 'ArrowRight'});
        expect(onCommit).toHaveBeenLastCalledWith(296);
        fireEvent.keyDown(divider, {key: 'ArrowLeft'});
        expect(onCommit).toHaveBeenLastCalledWith(264);
        fireEvent.keyDown(divider, {key: 'Home'});
        expect(onCommit).toHaveBeenLastCalledWith(PANEL_MIN_WIDTH);
        fireEvent.keyDown(divider, {key: 'End'});
        expect(onCommit).toHaveBeenLastCalledWith(400);
    });

    it('does not re-commit a keyboard step already at the edge', () => {
        const {divider, onCommit} = renderResizer({width: PANEL_MIN_WIDTH});
        fireEvent.keyDown(divider, {key: 'ArrowLeft'});
        fireEvent.keyDown(divider, {key: 'Home'});
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('marks <body> while dragging so the app keeps the resize cursor', () => {
        const {divider} = renderResizer();
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        expect(document.body).toHaveClass('panel-resizing');
        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(document.body).not.toHaveClass('panel-resizing');
    });

    it('does not commit a stray click (zero movement)', () => {
        const {divider, onCommit} = renderResizer();
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerUp(divider, {pointerId: 1});
        // Would otherwise pin today's stylesheet default into localStorage as a chosen width —
        // and the first click of a double-click reset would write the key the second removes.
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('a cap below the current width blocks growth but never yanks the panel back', () => {
        const {divider, onResize, onCommit} = renderResizer({getMaxWidth: () => 230});
        // Pointer: a rightward drag must hold the current 280, not snap back to the 230 cap.
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 104, pointerId: 1});
        expect(onResize).not.toHaveBeenCalled();
        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(onCommit).not.toHaveBeenCalled();
        // Keyboard: growth is a no-op, but shrinking still steps normally (280 → 264, not 230).
        fireEvent.keyDown(divider, {key: 'ArrowRight'});
        expect(onCommit).not.toHaveBeenCalled();
        fireEvent.keyDown(divider, {key: 'ArrowLeft'});
        expect(onCommit).toHaveBeenLastCalledWith(264);
    });

    it('keeps aria-valuenow live during a drag (state only commits on release)', () => {
        const {divider} = renderResizer();
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 140, pointerId: 1});
        expect(divider).toHaveAttribute('aria-valuenow', '320');
    });

    it('commits the dragged width if unmounted mid-drag', () => {
        // The rail can close under ⌘⇧\ while its divider is held: no pointerup will ever arrive,
        // so the unmount path must both commit the width the DOM shows and drop the body class.
        const {divider, onCommit, unmount} = renderResizer();
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 140, pointerId: 1});
        unmount();
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(320);
        expect(document.body).not.toHaveClass('panel-resizing');
    });

    it('survives a parent re-render mid-drag even with an unstable onCommit', () => {
        // The unmount cleanup tears down the live gesture, so it must key on `dragging` ALONE.
        // Naming onCommit as a dep instead makes an inline-lambda caller lose the drag on any
        // parent render: premature commit, later moves ignored, and the body class stuck on
        // (endDrag returns early, so `dragging` never clears) — the whole app left in col-resize.
        const onCommit = vi.fn();
        function Parent() {
            const [tick, setTick] = useState(0);
            return (
                <>
                    <button type="button" onClick={() => setTick(tick + 1)}>
                        rerender
                    </button>
                    <PanelResizer
                        label="Resize note list"
                        width={280}
                        onResize={vi.fn()}
                        // Deliberately a new identity every parent render.
                        onCommit={(w) => onCommit(w)}
                        onReset={vi.fn()}
                    />
                </>
            );
        }
        renderWithProviders(<Parent />);
        const divider = screen.getByRole('separator', {name: 'Resize note list'});
        fireEvent.pointerDown(divider, {button: 0, clientX: 100, pointerId: 1});
        fireEvent.pointerMove(divider, {clientX: 140, pointerId: 1});
        fireEvent.click(screen.getByRole('button', {name: 'rerender'}));
        expect(onCommit).not.toHaveBeenCalled();
        // The gesture is still live: this move lands, and the release commits it exactly once.
        fireEvent.pointerMove(divider, {clientX: 200, pointerId: 1});
        fireEvent.pointerUp(divider, {pointerId: 1});
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(380);
        expect(document.body).not.toHaveClass('panel-resizing');
    });
});
