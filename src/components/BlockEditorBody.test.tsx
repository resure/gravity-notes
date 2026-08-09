import {createRef} from 'react';

import {render} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {describe, expect, it, vi} from 'vitest';

import type {Note} from '../storage/types';

import {BlockEditorBody, type BlockEditorBodyHandle} from './BlockEditorBody';

function note(id: string, content: string): Note {
    return {id, title: id.replace(/\.md$/, ''), content, updatedAt: 1};
}

describe('BlockEditorBody — the raw-Markdown escape hatch', () => {
    /**
     * The pane is not keyed, so this component (and its ⌘⇧; mode flag) survives a note switch. The
     * textarea is uncontrolled, and once the user has typed in it the browser sets its dirty-value
     * flag — after which the HTML spec says a changed `defaultValue` is IGNORED. So switching notes
     * in markup mode left note A's source on screen under note B's title, and the next keystroke
     * autosaved A's body into B's file. Keying the textarea on the session forces the remount that
     * makes the new note's text actually appear.
     */
    it('shows the new note after a switch made while in markup mode', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        const props = {
            preview: false,
            onChange,
            onUploadFile: async () => '',
            onOpenWikiLink: () => {},
        };

        const {rerender} = render(
            <BlockEditorBody ref={ref} note={note('A.md', 'AAA body')} sessionId={1} {...props} />,
        );

        act(() => ref.current!.toggleMode());
        const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;
        expect(textarea().value).toBe('AAA body');

        // Type, so the textarea's dirty-value flag is set — this is what made `defaultValue` inert.
        act(() => {
            textarea().value = 'AAA edited';
            textarea().dispatchEvent(new Event('input', {bubbles: true}));
        });
        onChange.mockClear();

        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('B.md', 'BBB other note')}
                sessionId={2}
                {...props}
            />,
        );

        expect(textarea().value).toBe('BBB other note');
        // …and crucially, the switch itself must not report A's text as an edit to B.
        expect(onChange).not.toHaveBeenCalled();
    });
});
