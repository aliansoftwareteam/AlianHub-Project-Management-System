import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const LOCALES = path.join(SRC, 'locales');
const CALLERS = [
    'components/organisms/SprinstList/SprintsList.vue',
    'components/molecules/SubItem/SubItem.vue',
    'plugins/tasklistDashboard/components/organisms/SprintListing/SprintListing.vue'
];
const KINDS = ['Folder', 'Sprint'];
const SAID_AS = { Folder: 'Folder', Sprint: 'List' };
const OUTCOMES = ['restored', 'archived', 'deleted'];

describe('the message after a folder or a list is restored, archived or deleted', () => {
    it.each(CALLERS)('%s builds its key from a kind and an outcome', (file) => {
        const source = fs.readFileSync(path.join(SRC, file), 'utf8');
        expect(source).toMatch(/Toast\.\$\{[^}]*'Folder' : 'Sprint'\} \$\{[^}]*'restored'[^}]*\} successfully/);
    });

    it.each(KINDS.flatMap((kind) => OUTCOMES.map((outcome) => [kind, outcome])))('has words for "%s %s successfully"', (kind, outcome) => {
        expect(en.Toast[`${kind} ${outcome} successfully`]).toBe(`${SAID_AS[kind]} ${outcome} successfully`);
    });

    it('is not kept under a misspelled key in any language', () => {
        const holding = fs.readdirSync(LOCALES).filter((file) => fs.readFileSync(path.join(LOCALES, file), 'utf8').includes('Folde restored'));
        expect(holding).toEqual([]);
    });
});
