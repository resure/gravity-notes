import transform from '@diplodoc/transform';
import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {NotePreview, withWikiLinks} from './NotePreview';

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

    it('renders [[wiki links]] in the preview body as bracket-less link spans', async () => {
        transformMock.mockImplementation(await realTransform());

        const {container} = renderWithProviders(<NotePreview markup="See [[Roadmap]] here" />);

        const body = requireBody(container);
        expect(body.querySelector('.wiki-link')?.textContent).toBe('Roadmap');
        expect(body.textContent).not.toContain('[[');
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

describe('withWikiLinks', () => {
    it('renders [[wiki links]] as bracket-less link spans, preserving surrounding text', () => {
        const out = withWikiLinks('<p>See [[Roadmap]] here</p>');
        expect(out).toContain('<span class="wiki-link">Roadmap</span>');
        expect(out).not.toContain('[[');
        expect(out).toContain('See ');
        expect(out).toContain(' here');
    });

    it('handles several links in one block', () => {
        const out = withWikiLinks('<p>[[A]] and [[B]]</p>');
        expect(out.match(/class="wiki-link"/g) ?? []).toHaveLength(2);
    });

    it('leaves links inside code / pre / existing anchors untouched', () => {
        expect(withWikiLinks('<p><code>[[A]]</code></p>')).toContain('<code>[[A]]</code>');
        expect(withWikiLinks('<pre>[[A]]</pre>')).toContain('<pre>[[A]]</pre>');
        expect(withWikiLinks('<a href="x">[[A]]</a>')).toContain('>[[A]]</a>');
    });

    it('returns the HTML unchanged when there are no wiki links', () => {
        const html = '<p>nothing to see</p>';
        expect(withWikiLinks(html)).toBe(html);
    });
});
