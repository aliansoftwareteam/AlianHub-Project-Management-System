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

describe('buttons rendered as links', () => {
    test('.ah-btn and .ah-tbtn drop the link underline', () => {
        expect(ruleBody(read('assets/css/tokens.css'), '.ah-btn')).toMatch(/text-decoration:\s*none/);
        expect(ruleBody(read('components/molecules/Home/style.css'), '.ah-tbtn')).toMatch(/text-decoration:\s*none/);
    });
});

describe('Planner', () => {
    const css = read('views/Planner/style.css');

    test('the unscheduled tray is never hidden: it lives in the sidebar the toggle opens', () => {
        expect(css).not.toMatch(/\.planner__tray\s*\{\s*display:\s*none/);
    });

    test('the week range buttons drop the browser button chrome', () => {
        const rule = ruleBody(css, '.planner__range button');
        expect(rule).toMatch(/border:\s*0/);
        expect(rule).toMatch(/background:\s*transparent/);
    });
});
