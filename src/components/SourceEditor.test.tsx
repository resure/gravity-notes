import {createRef} from 'react';

import {fireEvent, render} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {describe, expect, it, vi} from 'vitest';

import SourceEditor from './SourceEditor';
import type {SourceHandle} from './SourceSurface';

function mount(value: string) {
    const ref = createRef<SourceHandle>();
    const onChange = vi.fn();
    render(<SourceEditor ref={ref} value={value} onChange={onChange} />);
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    return {ref, onChange, content};
}

describe('SourceEditor', () => {
    it('shows the note and labels the surface', () => {
        const {content} = mount('# Title\n\nbody');
        expect(content).toHaveAttribute('aria-label', 'Markdown source');
        expect(content.textContent).toContain('# Title');
    });

    it('reports an empty first line only with the caret alone at its start', () => {
        const {ref} = mount('\nsecond');
        act(() => {
            ref.current!.focus();
            ref.current!.moveCursor('start');
        });
        expect(ref.current!.atEmptyFirstLine()).toBe(true);
        act(() => ref.current!.moveCursor('end'));
        expect(ref.current!.atEmptyFirstLine()).toBe(false);
    });

    it('leaves the app its chords, and keeps the editing ones', () => {
        const {ref, content} = mount('one\ntwo');
        act(() => ref.current!.focus());
        const help = createEventFor(content, {key: '/', metaKey: true});
        expect(help.defaultPrevented).toBe(false);
        const moveLine = createEventFor(content, {key: 'ArrowDown', altKey: true});
        expect(moveLine.defaultPrevented).toBe(true);
    });
});

function createEventFor(target: HTMLElement, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init});
    act(() => {
        fireEvent(target, event);
    });
    return event;
}
