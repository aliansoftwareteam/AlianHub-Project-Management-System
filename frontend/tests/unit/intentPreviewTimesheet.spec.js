import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, named) => i18n().global.t(key, named);

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a timesheet week an agent wants to send', () => {
    const preview = {
        kind: 'timesheetWeek',
        title: '2026-09-28 – 2026-10-04',
        lines: [{ kind: 'timesheetWeek', from: '2026-09-28', to: '2026-10-04' }, { kind: 'timesheetNote', text: 'All <b>in</b>' }],
    };

    it('names the week and shows the note as text', () => {
        mountCard(preview);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('Timesheet week to send for approval');
        expect(rows()).toEqual([['timesheetWeek', 'Week', 'Sep 28, 2026 to Oct 4, 2026'], ['timesheetNote', 'Note', 'All <b>in</b>']]);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(intentTitle(t, preview)).toBe('send your timesheet week 2026-09-28 – 2026-10-04 for approval');
    });

    it('leaves out a week whose days are not dates', () => {
        mountCard({ ...preview, lines: [{ kind: 'timesheetWeek', from: 'soon', to: '2026-10-04' }] });
        expect(rows()).toEqual([]);
    });
});
