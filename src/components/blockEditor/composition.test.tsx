import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import Editor from './Editor';
import {setCaret} from './caret';

describe('IME input', () => {
    it('leaves Markdown and the live DOM alone until composition ends', () => {
        const onChange = vi.fn();
        render(<Editor value="" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        fireEvent.compositionStart(content);
        content.textContent = '---';
        setCaret(content, 'end');
        fireEvent.input(content, {isComposing: true});
        expect(document.querySelectorAll('.block')).toHaveLength(1);
        expect(content.textContent).toBe('---');
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.compositionEnd(content);
        expect(onChange).toHaveBeenCalled();
    });

    it('does not split a paragraph on composition confirmation without isComposing', () => {
        const onChange = vi.fn();
        render(<Editor value="日本語" onChange={onChange} />);
        const content = document.querySelector<HTMLElement>('.content')!;
        content.focus();
        setCaret(content, 'end');
        fireEvent.compositionStart(content);
        fireEvent.keyDown(content, {key: 'Enter', keyCode: 229});
        expect(document.querySelectorAll('.block')).toHaveLength(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not move between table cells while the IME owns Tab', () => {
        const onChange = vi.fn();
        render(<Editor value={'| a | b |\n| --- | --- |\n| c | d |'} onChange={onChange} />);
        const cell = document.querySelector<HTMLElement>('.table-cell-content')!;
        cell.focus();
        setCaret(cell, 'end');
        fireEvent.compositionStart(cell);
        fireEvent.keyDown(cell, {key: 'Tab', isComposing: true});
        expect(document.activeElement).toBe(cell);
        expect(onChange).not.toHaveBeenCalled();
    });
});
