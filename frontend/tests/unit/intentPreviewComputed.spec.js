import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

let wrapper;
const mountCard = (lines) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: { kind: 'fields', title: 'Cost total', lines } }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);
const rollup = (fn, source = 'Cost') => ({ kind: 'computedField', name: 'Cost total', type: 'rollup', function: fn, source });

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a rollup or a formula an agent wants to add', () => {
    it('says in plain words what each rollup works out, and from which field', () => {
        mountCard([rollup('sum'), rollup('avg'), rollup('min'), rollup('max'), rollup('count', ''), rollup('count')]);
        expect(rows().map((row) => row[2])).toEqual([
            'Cost total: the total of Cost on the subtasks under each task',
            'Cost total: the average of Cost on the subtasks under each task',
            'Cost total: the lowest Cost on the subtasks under each task',
            'Cost total: the highest Cost on the subtasks under each task',
            'Cost total: how many subtasks are under each task',
            'Cost total: how many subtasks under each task have Cost filled in',
        ]);
        expect(rows()[0].slice(0, 2)).toEqual(['computedField', 'Field']);
    });

    it('shows a formula as it was written, as text', () => {
        mountCard([{ kind: 'computedField', name: 'Margin', type: 'formula', expression: '{Price} - {Cost} <b>' }]);
        expect(rows()).toEqual([['computedField', 'Field', 'Margin: worked out as {Price} - {Cost} <b>']]);
        expect(wrapper.find('b').exists()).toBe(false);
    });

    it('names only the field where the line says nothing it has words for', () => {
        mountCard([rollup('median'), rollup('sum', ''), { kind: 'computedField', name: 'Margin', type: 'formula', expression: '' }, { kind: 'computedField', name: '', type: 'rollup', function: 'sum', source: 'Cost' }]);
        expect(rows().map((row) => row[2])).toEqual(['Cost total', 'Cost total', 'Margin']);
    });
});
