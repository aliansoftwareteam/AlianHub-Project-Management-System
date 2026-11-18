import { describe, expect, it } from 'vitest';
import { tagChipColors, tagChipStyle } from '@/utils/statusChipColors';
import { worstContrast } from '../wcagContrast';

// The tag editor gives a new tag a random #rrggbb and its colour input takes any other; both save
// the tint as that colour at alpha 0x35. Every channel here steps through all sixteen hex digits.
const DIGITS = [...'0123456789abcdef'];
const EDITOR_COLOURS = DIGITS.flatMap((r) => DIGITS.flatMap((g) => DIGITS.map((b) => `#${r}${r}${g}${g}${b}${b}`)));
const tagOf = (colour) => ({ uid: colour, tagName: colour, tagColor: colour, tagBgColor: `${colour}35` });

const navy = tagOf('#2f3990');
const lemon = tagOf('#ffff00');

describe('tagChipColors', () => {
    it.each(['light', 'dark'])('gives every colour the tag editor can save AA text on its own tint in the %s theme', (theme) => {
        expect(EDITOR_COLOURS).toHaveLength(4096);
        const failing = EDITOR_COLOURS.map(tagOf).filter((tag) => {
            const { background, color } = tagChipColors(tag, { dark: theme === 'dark' });
            return background !== tag.tagBgColor || worstContrast(color, background, theme) < 4.5;
        });
        expect(failing.map((tag) => tag.tagColor)).toEqual([]);
    });

    it('lifts a navy tag off its tint in the dark theme and keeps it blue', () => {
        expect(worstContrast(navy.tagColor, navy.tagBgColor, 'dark')).toBeLessThan(2);
        const { color } = tagChipColors(navy, { dark: true });
        expect(worstContrast(color, navy.tagBgColor, 'dark')).toBeGreaterThanOrEqual(4.5);
        const [r, g, b] = color.match(/[0-9a-f]{2}/g).map((pair) => parseInt(pair, 16));
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
    });

    it('darkens a lemon tag on its tint in the light theme', () => {
        expect(worstContrast(lemon.tagColor, lemon.tagBgColor, 'light')).toBeLessThan(2);
        expect(worstContrast(tagChipColors(lemon).color, lemon.tagBgColor, 'light')).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps a tag colour that already passes', () => {
        expect(tagChipColors(navy).color).toBe(navy.tagColor);
    });
});

describe('tagChipStyle', () => {
    it('paints the light text and carries the dark text for the dark theme', () => {
        const style = tagChipStyle(navy);
        expect(style.background).toBe(navy.tagBgColor);
        expect(style.color).toBe(`var(--status-ink, ${tagChipColors(navy).color})`);
        expect(style['--status-ink-dark']).toBe(tagChipColors(navy, { dark: true }).color);
    });
});
