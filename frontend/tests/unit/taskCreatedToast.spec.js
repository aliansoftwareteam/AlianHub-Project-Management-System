import { describe, expect, it } from 'vitest';
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

const TRANSLATED = { ar, ch, fr, ge, gr, gu, hi, it: it_, ru, spa };

describe('the toast every task create shows', () => {
    it('reads in sentence case and is spelled right', () => {
        expect(en.Toast.task_created_successfully).toBe('Task created successfully');
    });

    it.each(Object.entries(TRANSLATED))('%s does not keep the old misspelled English', (_code, messages) => {
        expect(messages.Toast.task_created_successfully).not.toMatch(/Succeessfully/);
    });
});
