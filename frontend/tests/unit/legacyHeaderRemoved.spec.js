import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'locales' ? [] : walk(full);
    return /\.(css|scss|vue|js|ts)$/.test(entry.name) ? [full] : [];
});
const sources = walk(SRC).map((file) => ({ rel: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8') }));
const filesContaining = (needle) => sources.filter(({ text }) => text.includes(needle)).map(({ rel }) => rel);

describe('the rail shell is the only shell', () => {
    test('nothing reads the ah.legacyNav fallback flag', () => {
        expect(filesContaining('ah.legacyNav')).toEqual([]);
    });

    test('no stylesheet or component uses a --kiln- alias', () => {
        expect(filesContaining('--kiln-')).toEqual([]);
    });

    test('App.vue does not import the old Header or NavLinks', () => {
        const app = read('App.vue');
        expect(app).not.toMatch(/organisms\/Header\//);
        expect(app).not.toMatch(/organisms\/NavLinks\//);
        expect(app).not.toMatch(/HeaderComponent/);
    });

    test('nothing imports the deleted Header component or NavLinks', () => {
        expect(filesContaining('organisms/Header/Header.vue')).toEqual([]);
        expect(filesContaining('organisms/NavLinks/')).toEqual([]);
    });
});

describe('rules other screens used from the old header stylesheet stay loaded', () => {
    test('the private-view dot keeps its blinking tick in the global stylesheet', () => {
        const css = read('assets/css/index.css');
        expect(css).toMatch(/\.notification-tick\s*\{/);
        expect(css).toMatch(/\.blinking\s*\{[^}]*animation:[^;]*\bblink\b/);
        expect(css).toMatch(/@keyframes blink\s*\{/);
    });

    test('the tour panel cards keep their styles in the shell stylesheet', () => {
        const css = read('components/organisms/Shell/style.css');
        for (const selector of ['.tour-box-card', '.tour__title', '.tour__description', '.tour_image', '.comment__notification-message']) {
            expect(css).toContain(`.tour_sidebar ${selector}`);
        }
    });

    test('the create-project status forms keep their column widths and heading padding', () => {
        const css = read('components/templates/CreateProject/style.css');
        expect(css).toMatch(/\.statusHeader h3\.heading_text\s*\{[^}]*padding:\s*30\.5px 16px/);
        expect(css).toMatch(/\.taskStatusLeft\s*\{[^}]*width:\s*47%/);
        expect(css).toMatch(/\.taskStatusRight\s*\{[^}]*width:\s*46\.742%/);
    });
});
