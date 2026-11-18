import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
});

describe('the legacy Roboto font', () => {
    const files = walk(SRC);

    test('is not shipped', () => {
        const fontFiles = files.filter((file) => /roboto/i.test(path.basename(file))).map((file) => path.relative(SRC, file));
        expect(fontFiles).toEqual([]);
    });

    test('is not named by any stylesheet, component, script or image, so text takes the design system font', () => {
        const offenders = files
            .filter((file) => /\.(css|scss|vue|js|svg|html)$/.test(file))
            .filter((file) => /roboto/i.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(SRC, file));
        expect(offenders).toEqual([]);
    });
});
