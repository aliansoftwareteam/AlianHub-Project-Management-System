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

describe('Ask landing', () => {
    test('the landing counts its padding inside the page width, so the composer is not cut on a phone', () => {
        const body = ruleBody(read('views/Ai/landing.css'), '.land');
        expect(body).toMatch(/width:\s*100%/);
        expect(body).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('Accounts → token rows on a phone', () => {
    const css = read('views/Ai/accounts.css');

    test('the meta line breaks between words, not inside "never used"', () => {
        const body = ruleBody(css, '.acct-token__meta');
        expect(body).toMatch(/overflow-wrap:\s*anywhere/);
        expect(body).not.toMatch(/word-break:\s*break-all/);
    });

    test('an expiry chip wraps inside the card instead of running past it', () => {
        const body = ruleBody(css, '.acct-token__flags .ah-chip');
        expect(body).toMatch(/max-width:\s*100%/);
        expect(body).toMatch(/white-space:\s*normal/);
        expect(body).toMatch(/height:\s*auto/);
    });
});

describe('Audit log on a phone', () => {
    const vue = read('views/Settings/Audit/AuditLog.vue');

    test('the filter tabs stay on one line and scroll inside the bar instead of running past the screen', () => {
        expect(ruleBody(vue, '.al__bar .ah-tabs')).toMatch(/max-width:\s*100%/);
        expect(ruleBody(vue, '.al__bar .ah-tabs')).toMatch(/overflow-x:\s*auto/);
        expect(ruleBody(vue, '.al__bar .ah-tab')).toMatch(/white-space:\s*nowrap/);
    });
});
