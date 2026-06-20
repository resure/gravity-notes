import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

describe('test environment', () => {
    it('renders into a jsdom document with jest-dom matchers wired', () => {
        render(<div>hello</div>);
        expect(screen.getByText('hello')).toBeInTheDocument();
    });
});
