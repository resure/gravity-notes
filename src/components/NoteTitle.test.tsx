import {createRef} from 'react';

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {NoteTitle, type NoteTitleHandle} from './NoteTitle';

function noop() {}

describe('NoteTitle', () => {
    it('shows the title and an Untitled placeholder', () => {
        render(<NoteTitle title="Ideas" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />);
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        expect(input.value).toBe('Ideas');
        expect(input.placeholder).toBe('Untitled');
    });

    it('commits the draft on blur', async () => {
        const user = userEvent.setup();
        const onCommit = vi.fn();
        render(<NoteTitle title="Old" onCommit={onCommit} onLeaveToBody={noop} onEscape={noop} />);
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'New');
        await user.tab();
        expect(onCommit).toHaveBeenCalledWith('New');
    });

    it('Enter and ArrowDown leave for the body', async () => {
        const user = userEvent.setup();
        const onLeaveToBody = vi.fn();
        render(
            <NoteTitle title="X" onCommit={noop} onLeaveToBody={onLeaveToBody} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title');
        input.focus();
        await user.keyboard('{Enter}');
        await user.keyboard('{ArrowDown}');
        expect(onLeaveToBody).toHaveBeenCalledTimes(2);
    });

    it('Escape reverts the draft and steps out', async () => {
        const user = userEvent.setup();
        const onEscape = vi.fn();
        const onCommit = vi.fn();
        render(
            <NoteTitle title="Keep" onCommit={onCommit} onLeaveToBody={noop} onEscape={onEscape} />,
        );
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        await user.clear(input);
        await user.type(input, 'Throwaway');
        await user.keyboard('{Escape}');
        expect(onEscape).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('Keep'); // reverted
    });

    it('does not commit the reverted draft when Escape blurs the field', async () => {
        const user = userEvent.setup();
        const onCommit = vi.fn();
        render(
            <NoteTitle
                title="Keep"
                onCommit={onCommit}
                onLeaveToBody={noop}
                onEscape={() => (document.activeElement as HTMLElement | null)?.blur()}
            />,
        );
        const input = screen.getByLabelText('Note title');
        await user.click(input);
        await user.clear(input);
        await user.type(input, 'Throwaway');
        await user.keyboard('{Escape}');
        expect(onCommit).not.toHaveBeenCalledWith('Throwaway');
    });

    it('commits a dirty draft on unmount (programmatic switch safety net)', async () => {
        const user = userEvent.setup();
        const onCommit = vi.fn();
        const {unmount} = render(
            <NoteTitle title="Old" onCommit={onCommit} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title');
        await user.clear(input);
        await user.type(input, 'Renamed');
        unmount();
        expect(onCommit).toHaveBeenCalledWith('Renamed');
    });

    it('syncs to a changed title prop only while unfocused', async () => {
        const user = userEvent.setup();
        const {rerender} = render(
            <NoteTitle title="First" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        const input = screen.getByLabelText('Note title') as HTMLInputElement;
        // Unfocused: a prop change updates the field.
        rerender(<NoteTitle title="Second" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />);
        expect(input.value).toBe('Second');
        // Focused + edited: a prop change must NOT clobber the user's typing.
        await user.click(input);
        await user.clear(input);
        await user.type(input, 'Typing');
        rerender(<NoteTitle title="Third" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />);
        expect(input.value).toBe('Typing');
    });

    it('focusAtEnd focuses the input', () => {
        const ref = createRef<NoteTitleHandle>();
        render(
            <NoteTitle ref={ref} title="Hi" onCommit={noop} onLeaveToBody={noop} onEscape={noop} />,
        );
        ref.current?.focusAtEnd();
        expect(screen.getByLabelText('Note title')).toHaveFocus();
    });
});
