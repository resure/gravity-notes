import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import Editor from './Editor';

afterEach(() => vi.restoreAllMocks());

function measurePopup(viewportHeight: number, top: number) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewportHeight);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
    ) {
        if (!this.classList.contains('wiki-tip')) return 0;
        const options = this.querySelectorAll('[role="option"]').length;
        return options ? 38 + options * 28 : 32;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        return this.classList.contains('wiki-link') ? new DOMRect(50, top, 80, 24) : new DOMRect();
    });
}

async function openChangeNote() {
    const notes = Array.from({length: 6}, (_, index) => ({
        id: `${index}.md`,
        title: index ? `Note ${index}` : 'Target',
        updatedAt: 1,
        preview: '',
    }));
    render(<Editor value="[[Target]]" notes={notes} onChange={vi.fn()} />);
    const content = document.querySelector<HTMLElement>('.content')!;
    const chip = content.querySelector('.wiki-link')!;
    await act(async () => {
        content.focus();
        const range = document.createRange();
        range.setStartAfter(chip);
        range.collapse(true);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    const popup = screen.getByRole('toolbar', {name: 'Link to Target'});
    fireEvent.click(screen.getByRole('button', {name: 'Change note'}));
    const input = screen.getByRole('combobox', {name: 'Search notes'});
    fireEvent.change(input, {target: {value: ''}});
    expect(screen.getAllByRole('option')).toHaveLength(6);
    return {popup, input};
}

describe('wiki Change note popup placement', () => {
    it('remeasures the expanded search and flips it above a chip near the window bottom', async () => {
        measurePopup(640, 550);
        const {popup} = await openChangeNote();
        expect(popup).toHaveStyle({top: '338px', maxHeight: '206px'});
        expect(parseFloat(popup.style.top) + parseFloat(popup.style.maxHeight)).toBeLessThan(628);
    });

    it('limits the search to the available height and scrolls keyboard selection into view', async () => {
        measurePopup(240, 150);
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        const {popup, input} = await openChangeNote();
        expect(popup).toHaveStyle({top: '12px', maxHeight: '132px'});
        scroll.mockClear();
        fireEvent.keyDown(input, {key: 'ArrowDown'});
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        expect(scroll).toHaveBeenCalledWith({block: 'nearest'});
    });

    it('retains the viewport height cap when filtering needs the same cap again', async () => {
        measurePopup(240, 150);
        const {popup, input} = await openChangeNote();
        expect(popup).toHaveStyle({top: '12px', maxHeight: '132px'});
        fireEvent.change(input, {target: {value: 'Note'}});
        expect(popup).toHaveStyle({top: '12px', maxHeight: '132px'});
        fireEvent.change(input, {target: {value: ''}});
        expect(popup).toHaveStyle({top: '12px', maxHeight: '132px'});
    });
});
