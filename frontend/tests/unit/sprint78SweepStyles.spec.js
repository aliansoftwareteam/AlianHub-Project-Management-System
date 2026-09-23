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
