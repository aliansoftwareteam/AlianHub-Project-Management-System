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

describe('auth card on a phone', () => {
    const css = read('components/templates/AuthShell/style.css');

    test('the single card counts its padding in its width and keeps a gutter', () => {
        const rule = ruleBody(css, '.auth--single .auth__form');
        expect(rule).toMatch(/box-sizing:\s*border-box/);
        expect(rule).toMatch(/width:\s*calc\(100% - 32px\)/);
    });

    test('full-width link buttons fit inside the card', () => {
        expect(ruleBody(css, '.auth .ah-btn--block')).toMatch(/box-sizing:\s*border-box/);
    });
});
