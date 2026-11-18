import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

// `() => {}` is a function body, so the prop defaults to undefined rather than an object.
const EMPTY_BODY_DEFAULT = /default:\s*\(\)\s*=>\s*\{\s*\}/;

// Fixed by #1679; drop these entries once it is merged.
const PENDING = new Set([
    'components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue:item',
    'components/organisms/TaskInSidebar/TaskInSidebar.vue:item'
]);

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(vue|js)$/.test(entry.name) ? [full] : [];
});

const declaredType = (lines, i) => {
    const inline = lines[i].match(/type:\s*(\[[^\]]*\]|\w+)/);
    if (inline) return inline[1];
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const m = lines[j].match(/type:\s*(\[[^\]]*\]|\w+)/);
        if (m) return m[1];
        if (/\{\s*$/.test(lines[j])) break;
    }
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
        if (/^\s*\}/.test(lines[j])) break;
        const m = lines[j].match(/type:\s*(\[[^\]]*\]|\w+)/);
        if (m) return m[1];
    }
    return null;
};

const propName = (lines, i) => {
    for (let j = i; j >= Math.max(0, i - 6); j--) {
        const m = lines[j].match(/^\s*['"]?([\w$-]+)['"]?\s*:\s*\{/);
        if (m) return m[1];
    }
    return null;
};

describe('Object and Array prop defaults', () => {
    it('return a value instead of an empty function body', () => {
        const offenders = [];
        for (const file of sourceFiles(SRC)) {
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            const rel = path.relative(SRC, file).split(path.sep).join('/');
            lines.forEach((line, i) => {
                if (!EMPTY_BODY_DEFAULT.test(line)) return;
                const type = declaredType(lines, i);
                if (type !== 'Object' && type !== 'Array') return;
                if (PENDING.has(`${rel}:${propName(lines, i)}`)) return;
                offenders.push(`${rel}:${i + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});
