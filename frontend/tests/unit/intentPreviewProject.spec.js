import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';
import { unappliedOf } from '@/views/Inbox/approvalQueue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, named) => i18n().global.t(key, named);

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a project an agent wants to create', () => {
    const project = {
        kind: 'project',
        title: 'Website relaunch',
        lines: [
            { kind: 'members', only: 'approver' },
            { kind: 'description', text: 'Everything for the <b>new</b> site.', more: false },
            { kind: 'newStatuses', names: ['In Review'] },
            { kind: 'newLists', names: ['Backlog', 'This week'] },
            { kind: 'field', name: 'Budget', type: 'money', options: [] },
            { kind: 'planView', name: 'Review board', layout: 'board' },
            { kind: 'group', by: 'status', field: '' },
            { kind: 'columns', names: ['Budget'], others: 0 },
        ],
    };

    it('says it is a new project, its name, who will be on it, and every part of its plan', () => {
        mountCard(project);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New project');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('Website relaunch');
        expect(rows()).toEqual([
            ['members', 'On it', 'Only the person who approves it, at first. It starts private; add people in the project afterwards.'],
            ['description', 'Description', 'Everything for the <b>new</b> site.'],
            ['newStatuses', 'New statuses', 'In Review'],
            ['newLists', 'New lists', 'Backlog, This week'],
            ['field', 'Field', 'Budget: Money'],
            ['planView', 'New view', 'Review board: Board'],
            ['group', 'Grouped by', 'Status'],
            ['columns', 'Columns', 'Budget'],
        ]);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(intentTitle(t, project)).toBe('create the project “Website relaunch”');
    });

    it('shows a project asked for by its name alone, and leaves out a members line it has no words for', () => {
        mountCard({ kind: 'project', title: 'Hiring', lines: [{ kind: 'members', only: 'everyone' }] });
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New project');
        expect(rows()).toEqual([]);
    });
});

describe('what an approved project could not make', () => {
    it('counts each part of its plan that was not made', () => {
        const applied = [{ action: 'project.create', ok: true, result: { projectId: 'p1', made: 2, notMade: [{ part: 'description', name: 'description', error: 'not granted' }, { part: 'lists', name: 'Backlog', error: 'not granted' }] } }];
        expect(unappliedOf({ applied })).toEqual([{ ok: false, error: 'description: not granted' }, { ok: false, error: 'Backlog: not granted' }]);
    });
});
