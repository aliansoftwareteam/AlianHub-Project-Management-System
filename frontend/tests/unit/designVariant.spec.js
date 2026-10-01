import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

import { VARIANT_CHOICES, applyVariant, initTheme, shellState } from '@/components/organisms/Shell/shellState';

const html = document.documentElement;
const visit = (url) => window.history.replaceState(null, '', url);

afterEach(() => {
    visit('/');
    localStorage.clear();
    html.removeAttribute('data-variant');
});

describe('the design variant attribute', () => {
    it('offers the three variants and the classic look', () => {
        expect(VARIANT_CHOICES).toEqual(['a', 'b', 'c', 'classic']);
    });

    it('is absent when nothing is stored, so the app wears the default with no attribute', () => {
        initTheme();
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(shellState.variant).toBe('');
        expect(localStorage.getItem('ah.variant')).toBeNull();
    });

    it('is applied on start from what was stored', () => {
        localStorage.setItem('ah.variant', 'b');
        initTheme();
        expect(html.getAttribute('data-variant')).toBe('b');
        expect(shellState.variant).toBe('b');
    });

    it('ignores a stored value that is not a variant', () => {
        localStorage.setItem('ah.variant', 'kiln');
        initTheme();
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(shellState.variant).toBe('');
    });

    it('leaves the theme attribute alone', () => {
        localStorage.setItem('ah.variant', 'c');
        initTheme();
        expect(html.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
    });

    it.each([
        ['before the hash', '/?variant=c#/company-1/home', 'c'],
        ['inside the hash route', '/#/company-1/home?variant=a', 'a'],
        ['next to other parameters', '/#/company-1/project/p1?view=list&variant=b', 'b'],
    ])('is set by ?variant= %s, and kept for the next visit', (_, url, expected) => {
        visit(url);
        initTheme();
        expect(html.getAttribute('data-variant')).toBe(expected);
        expect(localStorage.getItem('ah.variant')).toBe(expected);
    });

    it('takes the link over the stored choice', () => {
        localStorage.setItem('ah.variant', 'a');
        visit('/#/company-1/home?variant=c');
        initTheme();
        expect(html.getAttribute('data-variant')).toBe('c');
    });

    it('keeps the stored choice when the link names no known variant', () => {
        localStorage.setItem('ah.variant', 'a');
        visit('/#/company-1/home?variant=zzz');
        initTheme();
        expect(html.getAttribute('data-variant')).toBe('a');
        expect(localStorage.getItem('ah.variant')).toBe('a');
    });

    it('is cleared by ?variant=off', () => {
        localStorage.setItem('ah.variant', 'b');
        visit('/#/company-1/home?variant=off');
        initTheme();
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(localStorage.getItem('ah.variant')).toBeNull();
    });

    it('switches live from the setting and is remembered on this browser only', () => {
        applyVariant('b');
        expect(html.getAttribute('data-variant')).toBe('b');
        expect(shellState.variant).toBe('b');
        expect(localStorage.getItem('ah.variant')).toBe('b');

        applyVariant('c');
        expect(html.getAttribute('data-variant')).toBe('c');

        applyVariant('');
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(shellState.variant).toBe('');
        expect(localStorage.getItem('ah.variant')).toBeNull();
    });
});
