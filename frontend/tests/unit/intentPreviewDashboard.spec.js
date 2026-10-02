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

describe('the preview card for a dashboard card an agent wants to add', () => {
    it('names the dashboard, the card in the editor\'s words and the span of time it covers', () => {
        const preview = { kind: 'dashboardCard', title: 'My <b>board</b>', lines: [{ kind: 'dashboard', name: 'My <b>board</b>', isNew: false }, { kind: 'card', card: 'TasksByStatusCard', period: 3 }] };
        mountCard(preview);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New dashboard card');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('My <b>board</b>');
        expect(rows()).toEqual([['dashboard', 'Dashboard', 'My <b>board</b>'], ['card', 'Card', 'Tasks by status · This week']]);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(intentTitle(t, preview)).toBe('add a card to the dashboard “My <b>board</b>”');
    });

    it('says a dashboard is new and whose it will be, and shows a card with no span of time by its name alone', () => {
        mountCard({ kind: 'dashboardCard', title: 'Board', lines: [{ kind: 'dashboard', name: 'Board', isNew: true }, { kind: 'card', card: 'DueSoonCard' }] });
        expect(rows()).toEqual([['dashboard', 'Dashboard', 'Board: a new dashboard, private to its owner'], ['card', 'Card', 'My work']]);
    });

    it('leaves out a card the editor does not have', () => {
        mountCard({ kind: 'dashboardCard', title: 'Board', lines: [{ kind: 'dashboard', name: '', isNew: true }, { kind: 'card', card: 'NoSuchCard', period: 3 }] });
        expect(rows()).toEqual([]);
    });
});
