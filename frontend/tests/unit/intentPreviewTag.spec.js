import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import { intentSummary, intentTitle, kindLabel, linesOf } from '@/components/molecules/IntentPreview/intentLines';

const t = (key, named) => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }).global.t(key, named);

describe('the preview card for a tag an agent wants to add to a project', () => {
    const tag = { kind: 'tag', title: ' Needs design ', lines: [{ kind: 'place', project: 'Open', list: '' }] };

    it('names the tag and what will happen', () => {
        expect(kindLabel(t, tag)).toBe('New tag');
        expect(intentTitle(t, tag)).toBe('add the tag “Needs design” to the project');
        expect(intentSummary(t, tag)).toContain('Needs design');
    });

    it('says which project it goes on', () => {
        expect(linesOf(t, 'en', tag)).toEqual([expect.objectContaining({ kind: 'place', text: expect.stringContaining('Open') })]);
    });

    it('says nothing for a tag without a name', () => {
        expect(intentTitle(t, { ...tag, title: '  ' })).toBe('');
    });
});
