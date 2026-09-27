import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const styles = (rel) => { const vue = read(rel); return vue.slice(vue.indexOf('<style')); };

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const DARK = ':root[data-theme="dark"]';
const darkRules = (css) => css.split('}').filter((rule) => rule.includes(DARK)).join('}\n');

describe('Settings cards (.mySettingSection) in dark mode', () => {
    const css = read('components/molecules/Setting/style.css');
    const dark = darkRules(css);

    test('the card paints its surface and ink from the theme tokens', () => {
        const card = ruleBody(css, '.mySettingSection');
        expect(card).toMatch(/background:\s*var\(--surface\)/);
        expect(card).toMatch(/color:\s*var\(--ink\)/);
        expect(card).not.toMatch(/#fff/i);
    });

    test('text inputs, vuesax inputs and selects inside the card get a themed field, border and text', () => {
        expect(dark).toMatch(/\.mySettingSection[^{]*\.form-control/);
        expect(dark).toMatch(/\.mySettingSection[^{]*\.vs-input--input/);
        expect(dark).toMatch(/\.mySettingSection[^{]*select/);
        expect(dark).toMatch(/border-color:\s*var\(--ink-3\)/);
        expect(dark).toMatch(/color:\s*var\(--ink\)\s*!important/);
    });

    test('placeholders read at 4.5:1 on the dark field', () => {
        expect(dark).toMatch(/\.mySettingSection[^{]*::placeholder[^{]*\{[^}]*color:\s*var\(--ink-2\)/);
        expect(dark).toMatch(/\.mySettingSection[^{]*\.vs-input--placeholder/);
    });

    test('the light literals the dark card would hide are repainted: black text, grey chips, table head', () => {
        for (const selector of ['.black', 'span.font_family_status', '.con-vs-chip', '.currencies_wrapper_setting', '.milestone_wrapper_table thead', '.company__setting-toggle-copy p', '.white_btn', '.dropdown-arrow']) {
            expect(dark, selector).toContain(selector);
        }
    });
});

describe('The owner-only settings cards follow the theme', () => {
    const cards = {
        'components/molecules/Setting/SettingAutoCloseProjects.vue': ['.acp-card', '.acp-select'],
        'components/molecules/Setting/SettingScreenshotRetention.vue': ['.screenshot-retention-card', '.screenshot-retention-select'],
        'components/molecules/Setting/SettingTimeReminder.vue': ['.time-reminder-card', '.time-reminder-search-input'],
    };

    for (const [file, [card, field]] of Object.entries(cards)) {
        test(`${card} and its ${field} use the surface, ink and a 3:1 border`, () => {
            const css = styles(file);
            expect(ruleBody(css, card)).toMatch(/background:\s*var\(--surface\)/);
            expect(ruleBody(css, card)).toMatch(/color:\s*var\(--ink\)/);
            const dark = darkRules(css);
            expect(dark).toContain(card);
            expect(dark).toMatch(new RegExp(`${field.replace('.', '\\.')}[^{]*\\{[^}]*border-color:\\s*var\\(--ink-3\\)`));
        });
    }
});
