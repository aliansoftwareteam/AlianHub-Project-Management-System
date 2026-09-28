import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contrastOn } from '../wcagContrast';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

import { applyContrast, initTheme, resolveContrast, shellState } from '@/components/organisms/Shell/shellState';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tokens = fs.readFileSync(path.resolve(HERE, '../../src/assets/css/tokens.css'), 'utf8');

const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    if (start === -1) return '';
    return tokens.slice(start, tokens.indexOf('}', start));
};
const token = (body, name) => {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
    if (!match) throw new Error(`${name} is not set`);
    return match[1].trim();
};

const prefersMore = (matches) => {
    window.matchMedia = vi.fn((query) => ({
        matches: query === '(prefers-contrast: more)' ? matches : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }));
};

const html = document.documentElement;

afterEach(() => {
    delete window.matchMedia;
    html.classList.remove('ah-high-contrast');
    try { localStorage.clear(); } catch (e) { /* jsdom storage */ }
});

describe('the high-contrast theme', () => {
    it('applies from the setting and is remembered', () => {
        prefersMore(false);
        applyContrast('high');
        expect(html.classList.contains('ah-high-contrast')).toBe(true);
        expect(shellState.contrast).toBe('high');
        expect(localStorage.getItem('ah.contrast')).toBe('high');
        applyContrast('standard');
        expect(html.classList.contains('ah-high-contrast')).toBe(false);
    });

    it('follows prefers-contrast: more when left on automatic', () => {
        prefersMore(true);
        expect(resolveContrast('auto')).toBe('high');
        applyContrast('auto');
        expect(html.classList.contains('ah-high-contrast')).toBe(true);
        prefersMore(false);
        applyContrast('auto');
        expect(html.classList.contains('ah-high-contrast')).toBe(false);
    });

    it('keeps the user choice over the system preference', () => {
        prefersMore(true);
        applyContrast('standard');
        expect(html.classList.contains('ah-high-contrast')).toBe(false);
    });

    it('is applied on start from what was stored', () => {
        prefersMore(false);
        shellState.contrast = 'high';
        initTheme();
        expect(html.classList.contains('ah-high-contrast')).toBe(true);
    });

    const themes = {
        light: ':root.ah-high-contrast',
        dark: ':root.ah-high-contrast[data-theme="dark"]'
    };

    Object.entries(themes).forEach(([theme, selector]) => {
        it(`keeps body text at 7:1 or more in ${theme}`, () => {
            const body = block(selector);
            const grounds = ['--surface', '--surface-2', '--canvas'].map((name) => token(body, name));
            ['--ink', '--ink-2', '--ink-label', '--brand'].forEach((ink) => {
                grounds.forEach((ground) => {
                    expect(contrastOn(token(body, ink), ground, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(7);
                });
            });
            expect(contrastOn(token(body, '--on-brand'), token(body, '--brand'), token(body, '--surface'))).toBeGreaterThanOrEqual(7);
        });

        it(`draws borders at 3:1 or more in ${theme}`, () => {
            const body = block(selector);
            const surface = token(body, '--surface');
            ['--border', '--hairline'].forEach((name) => {
                expect(contrastOn(token(body, name), surface, surface), name).toBeGreaterThanOrEqual(3);
            });
        });
    });

    it('draws a focus ring no control can switch off', () => {
        expect(tokens).toMatch(/:root\.ah-high-contrast :focus-visible\s*\{[^}]*outline:[^;]*!important/);
    });
});
