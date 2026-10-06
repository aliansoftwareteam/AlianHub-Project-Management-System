import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import { linesOf } from '@/components/molecules/IntentPreview/intentLines';

const t = (...args) => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }).global.t(...args);
const card = (line) => ({ kind: 'batch', changes: 1, lines: [{ kind: 'batchItem', what: 'comment', value: 'Done', task: 'Open task', ...line }] });

describe('a waiting comment that replies in a thread', () => {
    it('says whom it answers when the server names them', () => {
        expect(linesOf(t, 'en', card({ replyTo: 'Mia Member' }))[0]).toMatchObject({ label: 'Comment', text: 'replying to Mia Member: Done, on “Open task”' });
    });

    it('shows the text alone when the server names nobody', () => {
        expect(linesOf(t, 'en', card({}))[0]).toMatchObject({ label: 'Comment', text: 'Done, on “Open task”' });
    });
});
