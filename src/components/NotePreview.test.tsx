import transform from '@diplodoc/transform';
import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {NotePreview} from './NotePreview';

// Default export is a vi.fn() so individual tests can delegate to the real
// transform or force a throw; the module is otherwise driven by the real impl.
// (vi.mock is hoisted above the imports above by Vitest.)
vi.mock('@diplodoc/transform', () => ({default: vi.fn()}));

const transformMock = vi.mocked(transform);

async function realTransform() {
    const actual = await vi.importActual<{default: typeof transform}>('@diplodoc/transform');
    return actual.default;
}

function requireBody(container: HTMLElement): HTMLElement {
    const body = container.querySelector<HTMLElement>('.note-preview__body');
    expect(body).not.toBeNull();
    return body as HTMLElement;
}

describe('NotePreview', () => {
    it('renders markup as HTML inside the preview body', async () => {
        transformMock.mockImplementation(await realTransform());

        const {container} = renderWithProviders(<NotePreview markup="# Hi" />);

        const heading = requireBody(container).querySelector('h1');
        expect(heading).not.toBeNull();
        expect(heading?.textContent).toContain('Hi');
    });

    it('escapes raw <script> so no script element is created', async () => {
        transformMock.mockImplementation(await realTransform());

        const {container} = renderWithProviders(<NotePreview markup="<script>alert(1)</script>" />);

        const body = requireBody(container);
        expect(body.querySelector('script')).toBeNull();
        // The literal text survives, just escaped to a harmless string.
        expect(body.textContent).toContain('<script>alert(1)</script>');
    });

    it('sanitizes an onerror handler off raw <img>', async () => {
        transformMock.mockImplementation(await realTransform());

        const {container} = renderWithProviders(
            <NotePreview markup="<img src=x onerror=alert(1)>" />,
        );

        const body = requireBody(container);
        // The raw tag is escaped to text, so no live <img> element exists at all;
        // were one rendered, it must not carry an onerror handler attribute.
        const img = body.querySelector('img');
        expect(img?.getAttribute('onerror') ?? null).toBeNull();
        // No DOM node ends up with a live onerror attribute (escaped text is fine).
        expect(body.querySelector('[onerror]')).toBeNull();
    });

    it('shows an error message instead of a blank body when transform throws', () => {
        transformMock.mockImplementationOnce(() => {
            throw new Error('boom');
        });

        const {container} = renderWithProviders(<NotePreview markup="# anything" />);

        expect(container.querySelector('.note-preview__body')).toBeNull();
        expect(screen.getByText(/Couldn.t render/)).toBeInTheDocument();
    });
});
