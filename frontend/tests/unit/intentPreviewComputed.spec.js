import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { chosenParts } from '@/components/molecules/IntentPreview/planPicks';

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

describe('a plan that holds a rollup and the view that shows it', () => {
    const plan = () => ({
        kind: 'setup',
        title: 'Website',
        lines: [
            { kind: 'place', project: 'Website', list: '' },
            { kind: 'computedField', name: 'Cost total', type: 'rollup', function: 'sum', source: 'Cost', pick: 'fields:0' },
            { kind: 'planView', name: 'Cost by status', layout: 'list', pick: 'views:0' },
            { kind: 'columns', names: ['Cost', 'Cost total'], others: 0, under: 'views:0' },
        ],
        needs: { 'views:0': ['fields:0'] },
    });
    const mountPlan = (leftOut = []) => {
        wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: plan(), choosable: true, leftOut }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };
    const picks = () => wrapper.findAll('[data-test="intent-pick"]');

    it('gives the rollup and the view a line and a tick box each', () => {
        mountPlan();
        expect(rows().slice(1).map((row) => [row[0], row[2]])).toEqual([
            ['computedField', 'Cost total: the total of Cost on the subtasks under each task'],
            ['planView', 'Cost by status: List'],
            ['columns', 'Cost, Cost total'],
        ]);
        expect(picks().map((el) => [el.attributes('data-pick'), el.element.checked])).toEqual([['fields:0', true], ['views:0', true]]);
    });

    it('leaves the view out with the rollup it shows, and keeps the rollup when only the view is left out', async () => {
        mountPlan();
        await picks()[0].setValue(false);
        expect(wrapper.emitted('update:leftOut')).toEqual([[['fields:0', 'views:0']]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Cost by status” is left out too: it needs “Cost total”.');
        expect(chosenParts(plan(), ['fields:0', 'views:0'])).toEqual({ fields: [], views: [] });
        expect(chosenParts(plan(), ['views:0'])).toEqual({ fields: [0], views: [] });
    });
});
