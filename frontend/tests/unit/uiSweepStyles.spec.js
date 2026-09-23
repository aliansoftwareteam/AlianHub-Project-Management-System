import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

describe('global element styles', () => {
    test('no stylesheet styles every <nav> by its tag', () => {
        const bareNav = /(^|[\s,}])nav(\s+a[^{,]*)?\s*\{/m;
        const offenders = walk(SRC).filter((file) => bareNav.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(SRC, file));
        expect(offenders).toEqual([]);
    });

    test('the starter template green active-link colour is gone', () => {
        expect(read('App.vue')).not.toMatch(/#42b983/i);
    });
});
