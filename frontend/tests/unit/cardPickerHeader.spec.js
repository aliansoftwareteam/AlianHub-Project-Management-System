import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sfc = fs.readFileSync(path.resolve(HERE, '../../src/views/Dashboards/CardPicker.vue'), 'utf8');
const template = sfc.slice(sfc.indexOf('<template>'), sfc.lastIndexOf('</template>'));
const style = sfc.slice(sfc.indexOf('<style scoped>'));
const PHONE = '@media (max-width: 768px)';
const desktop = style.slice(0, style.indexOf(PHONE));
const phone = style.slice(style.indexOf(PHONE));

const rule = (css, selector) => {
    const match = new RegExp(`(?:^|[\\s,}])${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    return match ? match[1] : '';
};
const tracks = (css) => /grid-template-columns:\s*([^;]+);/.exec(rule(css, '.dpick__head'))[1].trim().split(/\s+/);

describe('the Add a card header', () => {
    const head = template.slice(template.indexOf('<header class="dpick__head">'), template.indexOf('</header>'));

    test('holds the title, the lede, the search field and the close button', () => {
        expect(['<h2', 'dpick__lede', 'dpick__search', 'dpick__close'].map((part) => head.indexOf(part) !== -1)).toEqual([true, true, true, true]);
        expect(head.indexOf('dpick__search')).toBeLessThan(head.indexOf('dpick__close'));
    });

    test('gives the close button its own column instead of laying it over the search field', () => {
        expect(rule(desktop, '.dpick__close')).not.toMatch(/position:\s*absolute/);
        expect(tracks(desktop)).toHaveLength(4);
    });

    test('at phone width keeps the close button beside the title and the search field on a row of its own', () => {
        expect(rule(phone, '.dpick__close')).not.toMatch(/position:\s*absolute/);
        expect(tracks(phone)).toEqual(['1fr', 'auto']);
        expect(rule(phone, '.dpick__close')).toMatch(/grid-area:\s*1\s*\/\s*2/);
        expect(rule(phone, '.dpick__search')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
        expect(rule(phone, '.dpick__lede')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    });

    test('names the close button for a screen reader', () => {
        expect(head).toMatch(/class="dpick__close"[^>]*:aria-label="\$t\('Dash\.close'\)"/);
    });
});
