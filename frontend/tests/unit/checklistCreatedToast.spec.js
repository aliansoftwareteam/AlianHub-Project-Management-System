import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import en from '@/locales/en.js';
import ar from '@/locales/ar.js';
import ch from '@/locales/ch.js';
import fr from '@/locales/fr.js';
import ge from '@/locales/ge.js';
import gr from '@/locales/gr.js';
import gu from '@/locales/gu.js';
import hi from '@/locales/hi.js';
import it_ from '@/locales/it.js';
import ru from '@/locales/ru.js';
import spa from '@/locales/spa.js';

const LOCALES = { en, ar, ch, fr, ge, gr, gu, hi, it: it_, ru, spa };

/* vue-i18n reads a dot as a path separator, so a key ending in "." can never be looked up,
 * and translation tooling turned it into a nested { "": text } object in every locale. */
const unreachableKeys = (node, trail = []) => Object.entries(node).flatMap(([key, value]) => {
    const here = [...trail, key];
    const bad = key === '' || key.endsWith('.') ? [here.join(' > ')] : [];
    return value && typeof value === 'object' ? [...bad, ...unreachableKeys(value, here)] : bad;
});

describe('the toast the AI checklist shows after creating a checklist', () => {
    it('looks up a key that exists', () => {
        const source = readFileSync(path.resolve(__dirname, '../../src/components/molecules/CheckList/AiCheckList.vue'), 'utf8');
        expect(source).toContain("t(\"Toast.checklist_created_successfully\")");
        expect(en.Toast.checklist_created_successfully).toBe('Checklist created successfully');
    });

    it.each(Object.entries(LOCALES))('%s has it as text', (_code, messages) => {
        expect(typeof messages.Toast.checklist_created_successfully).toBe('string');
        expect(messages.Toast.checklist_created_successfully.length).toBeGreaterThan(0);
    });

    it.each(Object.entries(LOCALES))('%s has no key that vue-i18n cannot reach', (_code, messages) => {
        expect(unreachableKeys(messages)).toEqual([]);
    });
});
