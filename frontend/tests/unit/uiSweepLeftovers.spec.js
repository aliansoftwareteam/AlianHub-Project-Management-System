import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

describe('coloured chips in dark mode', () => {
    const css = read('assets/css/tokens.css');

    test('no theme rule out-specifies the chip variants', () => {
        expect(css).not.toMatch(/data-theme="dark"\]\s*\.ah-chip\s*\{/);
    });

    test('the neutral chip follows the theme through a token', () => {
        expect(ruleBody(css, '.ah-chip')).toMatch(/background:\s*var\(--fill\)/);
    });
});

describe('instance console cards', () => {
    const vue = read('views/Settings/Instance/InstanceShell.vue');

    test('paragraphs inside a card take the card gap only', () => {
        expect(ruleBody(vue, '.in-card')).toMatch(/gap:\s*8px/);
        expect(ruleBody(vue, '.in-card > p')).toMatch(/margin:\s*0/);
    });
});

describe('the setup checklist outside Home', () => {
    test('brings its own stylesheet, so Instance → Health renders it styled on a direct visit', () => {
        expect(read('components/molecules/Home/SetupChecklist.vue')).toMatch(/import\s+["']\.\/style\.css["']/);
        expect(ruleBody(read('components/molecules/Home/style.css'), '.hc-setup')).toMatch(/display:\s*flex/);
    });
});
