import {createRef} from 'react';

import {fireEvent, render} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {describe, expect, it, vi} from 'vitest';

import SourceEditor from './SourceEditor';
import type {SourceHandle} from './SourceSurface';

function mount(value: string) {
    const ref = createRef<SourceHandle>();
    const onChange = vi.fn();
    render(<SourceEditor ref={ref} readValue={() => value} onChange={onChange} />);
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

describe('SourceEditor — review regressions', () => {
    it('starts from the buffer as it is when it mounts, not when its element was created', () => {
        let buffer = 'typed before';
        const element = <SourceEditor readValue={() => buffer} onChange={vi.fn()} />;
        buffer = 'typed before and after';
        render(element);
        expect(document.querySelector('.cm-content')!.textContent).toBe('typed before and after');
    });

    it('does not offer the title a Backspace that deleted a selection', async () => {
        const {ref, content} = mount('first\nsecond');
        await act(async () => {
            ref.current!.focus();
            const range = document.createRange();
            range.selectNodeContents(content);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        let atEmpty: boolean | null = null;
        content.parentElement!.parentElement!.addEventListener('keydown', () => {
            atEmpty = ref.current!.atEmptyFirstLine();
        });
        createEventFor(content, {key: 'Backspace'});
        expect(content.textContent).toBe('');
        expect(atEmpty).toBe(false);
    });

    it('follows the spelling setting while it is open', async () => {
        const ref = createRef<SourceHandle>();
        const {container} = render(
            <div spellCheck={false}>
                <SourceEditor ref={ref} readValue={() => 'text'} onChange={vi.fn()} />
            </div>,
        );
        const content = () => document.querySelector('.cm-content')!;
        expect(content()).toHaveAttribute('spellcheck', 'false');
        await act(async () => {
            container.firstElementChild!.setAttribute('spellcheck', 'true');
            await Promise.resolve();
        });
        expect(content()).toHaveAttribute('spellcheck', 'true');
    });
});
