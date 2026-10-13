import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

const SPIN_RULE = /(^|[\s,}])\.ah-spin\s*\{([^}]*)\}/g;

const spinRules = (file) => [...fs.readFileSync(file, 'utf8').matchAll(SPIN_RULE)].map((match) => match[2]);

describe('the loading spinner inside buttons', () => {
    test('is defined once, in the global tokens', () => {
        const definers = walk(SRC).filter((file) => spinRules(file).length).map((file) => path.relative(SRC, file));
        expect(definers).toEqual([path.join('assets', 'css', 'tokens.css')]);
    });

    test('draws with the text colour of whatever holds it', () => {
        const [rule] = spinRules(path.join(SRC, 'assets/css/tokens.css'));
        expect(rule).toMatch(/border-top-color:\s*currentColor/);
        expect(rule).toMatch(/color-mix\(in srgb, currentColor/);
        expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });
});
