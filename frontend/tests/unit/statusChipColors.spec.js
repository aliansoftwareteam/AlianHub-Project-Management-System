import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { statusChipColors, statusChipCss, statusChipStyle } from '@/utils/statusChipColors';
import { worstContrast } from '../wcagContrast';

const require = createRequire(import.meta.url);
const templates = path.resolve(__dirname, '../../../utils/Tempates');

function colourPairs(node, found = []) {
    if (Array.isArray(node)) node.forEach((item) => colourPairs(item, found));
    else if (node && typeof node === 'object') {
        const bgColor = node.bgColor || node.backgroundColor;
        if (node.textColor && bgColor) found.push({ name: node.name, textColor: node.textColor, bgColor });
        Object.values(node).forEach((value) => colourPairs(value, found));
    }
    return found;
}

const seeded = [
    ...colourPairs(require(`${templates}/task_status.js`).TemplateData()),
    ...colourPairs(require(`${templates}/project_main_templates.js`).projectMainTemplates),
    ...colourPairs(require(`${templates}/project_status.js`).TemplateData())
];

const toDo = { name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035' };

describe('statusChipColors', () => {
    it('reads the seeded status palettes', () => {
        expect(seeded.length).toBeGreaterThan(20);
        expect(seeded).toContainEqual(toDo);
    });

    it.each(['light', 'dark'])('gives every seeded status AA text on its own tint in the %s theme', (theme) => {
        for (const status of seeded) {
            const { background, color } = statusChipColors(status, { dark: theme === 'dark' });
            expect(background).toBe(status.bgColor);
            expect(worstContrast(color, background, theme), `${status.name} ${status.textColor} on ${status.bgColor}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('darkens the To Do orange on its peach tint and keeps it orange', () => {
        expect(worstContrast(toDo.textColor, toDo.bgColor, 'light')).toBeLessThan(2);
        const [r, g, b] = statusChipColors(toDo).color.match(/[0-9a-f]{2}/g).map((pair) => parseInt(pair, 16));
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
    });

    it('keeps a stored text colour that already passes', () => {
        expect(statusChipColors({ textColor: '#000000', bgColor: '#eeeeee' }).color).toBe('#000000');
    });

    it('reads #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() colours', () => {
        const statuses = [
            { textColor: '#f90', bgColor: '#ffeecc' },
            { textColor: '#FF9600', bgColor: '#FF960035' },
            { textColor: 'rgb(255, 150, 0)', bgColor: 'rgba(255, 150, 0, 0.21)' },
            { textColor: 'rgb(255 150 0)', bgColor: 'rgb(255 150 0 / 21%)' }
        ];
        for (const status of statuses) {
            const { background, color } = statusChipColors(status);
            expect(background).toBe(status.bgColor);
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
            expect(worstContrast(color, background, 'light'), status.textColor).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('falls back to theme tokens when neither colour can be read', () => {
        for (const status of [null, undefined, {}, { textColor: 'orange-ish', bgColor: 'url(x)' }, { textColor: 42, bgColor: '#12345' }]) {
            expect(statusChipColors(status)).toEqual({ background: 'var(--fill)', color: 'var(--ink)' });
            expect(statusChipColors(status, { dark: true })).toEqual({ background: 'var(--fill)', color: 'var(--ink)' });
        }
    });

    it('derives the missing half from the colour that is there', () => {
        const textOnly = statusChipColors({ textColor: '#ff9600' });
        expect(textOnly.background).toMatch(/^rgba\(255, 150, 0, 0\.\d+\)$/);
        expect(worstContrast(textOnly.color, textOnly.background, 'light')).toBeGreaterThanOrEqual(4.5);

        const tintOnly = statusChipColors({ bgColor: '#ff960035' }, { dark: true });
        expect(tintOnly.background).toBe('#ff960035');
        expect(worstContrast(tintOnly.color, tintOnly.background, 'dark')).toBeGreaterThanOrEqual(4.5);
    });
});

describe('statusChipStyle', () => {
    it('paints the light text and carries the dark text for the dark theme', () => {
        const style = statusChipStyle(toDo);
        expect(style.background).toBe('#ff960035');
        expect(style.color).toBe(`var(--status-ink, ${statusChipColors(toDo).color})`);
        expect(style['--status-ink-dark']).toBe(statusChipColors(toDo, { dark: true }).color);
    });

    it('writes the same declarations for chips built as HTML', () => {
        const style = statusChipStyle(toDo);
        expect(statusChipCss(toDo)).toBe(`background:${style.background};color:${style.color};--status-ink-dark:${style['--status-ink-dark']}`);
    });

    it('switches to the dark text under the dark theme', () => {
        const tokens = readFileSync(path.resolve(__dirname, '../../src/assets/css/tokens.css'), 'utf8');
        expect(tokens).toMatch(/:root\[data-theme="dark"\] \.ah-status-ink \{ --status-ink: var\(--status-ink-dark\); \}/);
    });
});
