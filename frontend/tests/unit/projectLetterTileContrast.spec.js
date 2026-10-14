import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = (path) => readFileSync(resolve(__dirname, '../../src/assets/css', path), 'utf8');
const tokens = css('tokens.css');
const shared = css('index.css');

const linear = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const rgbOf = (hex) => [0, 2, 4].map((at) => parseInt(hex.replace('#', '').slice(at, at + 2), 16));
const whiteOn = (rgb) => 1.05 / (luminance(rgb) + 0.05);

/* The colours a project gets by default: the sample project's, the Create project screen's and an agent's. */
const PROJECT_COLOURS = ['#6473e8', '#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899'];

describe('a project letter tile', () => {
    const scrim = Number(/--tile-scrim:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(tokens)?.[1]);

    it('darkens its colour enough for white letters to read at 4.5:1 on every default colour', () => {
        expect(scrim).toBeGreaterThan(0);
        expect(/--tile-ink:\s*#ffffff/i.test(tokens)).toBe(true);
        PROJECT_COLOURS.forEach((hex) => {
            const shown = rgbOf(hex).map((channel) => channel * (1 - scrim));
            expect(whiteOn(shown), hex).toBeGreaterThanOrEqual(4.5);
        });
        expect(whiteOn(rgbOf('#6473e8'))).toBeLessThan(4.5);
    });

    it('is drawn with the scrim and the tile ink wherever the app shows one', () => {
        const rule = /([^{}]+)\{\s*background-image:\s*linear-gradient\(var\(--tile-scrim\), var\(--tile-scrim\)\);\s*color:\s*var\(--tile-ink\)\s*!important;\s*\}/.exec(shared);
        expect(rule).not.toBeNull();
        ['.inital-box', '.project-firtsleeter-box', 'span.ProjectFirstLatter', '.rap-icon'].forEach((selector) => expect(rule[1]).toContain(selector));
    });
});
