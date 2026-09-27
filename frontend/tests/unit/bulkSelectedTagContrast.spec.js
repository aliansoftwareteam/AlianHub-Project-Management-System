import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { tagChipColors } from '@/utils/statusChipColors';

const channels = (hex) => hex.replace('#', '').match(/../g).map((pair) => parseInt(pair, 16));
const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (rgb, alpha, surface) => rgb.map((c, i) => c * alpha + surface[i] * (1 - alpha));

const SELECTED_HOVER = [227, 230, 255];
const grid = [];
for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) grid.push([r, g, b]);
const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/* A selected row in the bulk tag menu is tinted (#eef0ff, #e3e6ff on hover), so chip text worked
 * out against the page background dropped to 3.99:1 there. */
describe('tag chips on a selected bulk menu row', () => {
    it('reach 4.5:1 against the chip tint laid over the selected row', () => {
        const failing = grid.filter((rgb) => {
            const tag = { tagColor: hex(rgb), tagBgColor: `${hex(rgb)}35` };
            const { color } = tagChipColors(tag, { surface: SELECTED_HOVER });
            return contrast(channels(color), over(rgb, 0x35 / 255, SELECTED_HOVER)) < 4.5;
        });
        expect(failing.map(hex)).toEqual([]);
    });

    it('are coloured for the selected row by the bulk bar', () => {
        const bar = readFileSync(path.resolve(__dirname, '../../src/components/molecules/BulkActionBar/BulkActionBar.vue'), 'utf8');
        expect(bar).toMatch(/tagChipColors\(tag, tagState\(tag\) !== 'none' \? SELECTED_ROW : undefined\)/);
    });
});
