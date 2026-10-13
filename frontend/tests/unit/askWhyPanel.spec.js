import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

const { echo } = vi.hoisted(() => ({ echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }));

vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import AskWhyPanel from '@/views/Ai/AskWhyPanel.vue';
import AskAnswer from '@/views/Ai/AskAnswer.vue';
import { KIND_KEYS, REASON_KEYS, messageKey } from '@/views/Ai/askWhy';
import en from '@/locales/en.js';

const PAGE = { kind: 'page', id: 'p1', ref: 'page:0000p1', title: 'Salary plan', project: 'Ops', projectId: 'pr1', detail: 'bands for next year', updatedAt: '2026-09-02T12:00:00Z', permission: { visibility: 'private', via: 'owner' } };
const TASK = { kind: 'task', id: 't1', ref: 'task:0000t1', title: 'Budget review', project: 'Ops', projectId: 'pr1', detail: 'check the numbers', updatedAt: '2026-09-01T12:00:00Z', permission: { visibility: 'project', via: 'project' } };
const COMPANY_PAGE = { kind: 'page', id: 'p2', ref: 'page:0000p2', title: 'Holiday policy', project: '', projectId: '', detail: 'twenty days', updatedAt: '2026-08-01T12:00:00Z', permission: { visibility: 'company', via: 'company' } };
const COMMENT = { kind: 'comment', id: 'c1', ref: 'comment:0000c1', title: 'On budget review', project: 'Ops', projectId: 'pr1', detail: 'agreed at 12k', updatedAt: '2026-09-03T12:00:00Z', permission: { visibility: 'project', via: 'task' } };
const CALL = { kind: 'transcript', id: 'k1', ref: 'transcript:0000k1', title: 'Budget sync', project: 'Ops', projectId: 'pr1', detail: 'we cut travel', updatedAt: '2026-09-04T12:00:00Z', permission: { visibility: 'participants', via: 'participant' } };

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { href: '#' }, slots.default && slots.default()) });
const withStubs = { mocks: { $t: echo }, stubs: { teleport: true, RouterLink: LinkStub } };

const mountPanel = (props) => mount(AskWhyPanel, { props: { sources: [], cited: [], privileged: false, ...props }, global: withStubs });
const rowsOf = (wrapper) => wrapper.findAll('[data-test="why-row"]');
const reasonOf = (row) => row.find('[data-test="why-reason"]');

let mounted = null;
afterEach(() => { if (mounted) { mounted.unmount(); mounted = null; } });

const flatKeys = (obj, prefix = '') => Object.entries(obj).flatMap(([key, value]) => (value && typeof value === 'object' ? flatKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`]));

describe('AskWhyPanel', () => {
    it('lists each retrieved passage with its kind, linked title, project, excerpt, date and reason', () => {
        const wrapper = mountPanel({ sources: [TASK, PAGE, COMPANY_PAGE, COMMENT, CALL], cited: ['task:0000t1'] });
        const rows = rowsOf(wrapper);
        expect(rows).toHaveLength(5);

        expect(rows[0].find('[data-test="why-kind"]').text()).toBe('Ask.kind_task');
        expect(rows[0].findComponent(LinkStub).props('to')).toEqual({ query: { task: 't1' } });
        expect(rows[0].find('[data-test="why-title"]').text()).toBe('Budget review');
        expect(rows[0].text()).toContain('Ops');
        expect(rows[0].text()).toContain('check the numbers');
        expect(rows[0].text()).toContain('Ask.why_updated {"date":"1 Sep 2026"}');
        expect(rows[0].find('[data-test="why-cited"]').exists()).toBe(true);
        expect(reasonOf(rows[0]).text()).toBe('Ask.reason_project_member');

        expect(rows[1].findComponent(LinkStub).props('to')).toEqual({ name: 'PageEditor', params: { cid: 'company-1', pageId: 'p1' } });
        expect(rows[1].find('[data-test="why-cited"]').exists()).toBe(false);

        expect(rows[2].text()).toContain('Ask.why_no_project');
        expect(reasonOf(rows[2]).text()).toBe('Ask.reason_company_page');

        expect(rows[3].find('[data-test="why-kind"]').text()).toBe('Ask.kind_comment');
        expect(rows[3].findComponent(LinkStub).exists()).toBe(false);
        expect(rows[3].find('[data-test="why-title"]').text()).toBe('On budget review');
        expect(reasonOf(rows[3]).text()).toBe('Ask.reason_project_member');

        expect(rows[4].find('[data-test="why-kind"]').text()).toBe('Ask.kind_transcript');
        expect(reasonOf(rows[4]).text()).toBe('Ask.reason_call_participant');

        expect(wrapper.find('[data-test="why-no-permission"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="why-empty"]').exists()).toBe(false);
    });

    it('tells the author of a private page that only they can see it', () => {
        const wrapper = mountPanel({ sources: [PAGE] });
        expect(reasonOf(rowsOf(wrapper)[0]).text()).toBe('Ask.reason_private_owner');
    });

    it('gives an owner or admin that reason for project passages, and keeps the private and call reasons', () => {
        const wrapper = mountPanel({ sources: [TASK, PAGE, CALL], privileged: true });
        expect(rowsOf(wrapper).map((row) => reasonOf(row).text())).toEqual(['Ask.reason_owner_admin', 'Ask.reason_private_owner', 'Ask.reason_call_participant']);
    });

    it('omits the reason line when the sources carry no permission, and says why', () => {
        const strip = (source) => Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'permission'));
        const wrapper = mountPanel({ sources: [strip(TASK), { ...strip(PAGE), detail: '' }] });
        const rows = rowsOf(wrapper);
        expect(rows).toHaveLength(2);
        rows.forEach((row) => expect(reasonOf(row).exists()).toBe(false));
        expect(rows[1].find('.ask-why__excerpt').exists()).toBe(false);
        expect(wrapper.find('[data-test="why-no-permission"]').text()).toBe('Ask.why_no_permission');
    });

    it('shows the empty state when nothing was retrieved', () => {
        const wrapper = mountPanel({ sources: [] });
        expect(rowsOf(wrapper)).toHaveLength(0);
        expect(wrapper.find('[data-test="why-empty"]').text()).toBe('Ask.why_empty');
        expect(wrapper.find('[data-test="why-no-permission"]').exists()).toBe(false);
    });

    it('is a labelled dialog with a labelled close control', () => {
        const wrapper = mountPanel({ sources: [TASK] });
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(dialog.attributes('aria-label')).toBe('Ask.why_title');
        expect(wrapper.find('[data-test="why-close"]').attributes('aria-label')).toBe('Ask.why_close');
    });
});

describe('AskAnswer', () => {
    const answer = {
        configured: true,
        mode: 'ask',
        answer: 'Bands are set [page:0000p1].',
        cited: [PAGE, { ...TASK, ref: 'task:gone00' }],
        sources: [PAGE, TASK],
        scope: { projects: 1, privileged: false },
        usage: { tokens: 42, model: 'm-1' }
    };

    it('cites only passages that are in the retrieved list', () => {
        const wrapper = mount(AskAnswer, { props: { answer }, global: withStubs });
        const cites = wrapper.findAll('.ask__cite');
        expect(cites).toHaveLength(1);
        expect(cites[0].text()).toContain('page:0000p1');
    });

    it('cites a task by its key and name, linked to the task', () => {
        const keyed = { ...TASK, ref: 'OPS-12' };
        const wrapper = mount(AskAnswer, { props: { answer: { ...answer, answer: 'Signed [OPS-12].', cited: [keyed], sources: [keyed] } }, global: withStubs });
        const cite = wrapper.find('.ask__cite');
        expect(cite.find('.ask__cite-ref').text()).toBe('OPS-12');
        expect(cite.text()).toContain('Budget review');
        expect(cite.findComponent(LinkStub).props('to')).toEqual({ query: { task: 't1' } });
    });

    it('opens the panel from the answer, focuses its close control and closes with Escape', async () => {
        mounted = mount(AskAnswer, { props: { answer }, global: withStubs, attachTo: document.body });
        const opener = mounted.find('[data-test="why-open"]');
        expect(mounted.find('[data-test="why-panel"]').exists()).toBe(false);
        expect(opener.attributes('aria-expanded')).toBe('false');

        await opener.trigger('click');
        await nextTick();
        const panel = mounted.find('[data-test="why-panel"]');
        expect(panel.exists()).toBe(true);
        expect(opener.attributes('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(mounted.find('[data-test="why-close"]').element);
        expect(mounted.findAll('[data-test="why-row"]')).toHaveLength(2);
        expect(mounted.find('[data-test="why-cited"]').exists()).toBe(true);

        await panel.trigger('keydown', { key: 'Escape' });
        await nextTick();
        expect(mounted.find('[data-test="why-panel"]').exists()).toBe(false);
        expect(document.activeElement).toBe(opener.element);
    });

    it('closes from the close control and keeps Tab inside the dialog', async () => {
        mounted = mount(AskAnswer, { props: { answer }, global: withStubs, attachTo: document.body });
        await mounted.find('[data-test="why-open"]').trigger('click');
        await nextTick();

        const panel = mounted.find('[data-test="why-panel"]');
        const closer = mounted.find('[data-test="why-close"]');
        const links = panel.findAll('a');
        links[links.length - 1].element.focus();
        await panel.trigger('keydown', { key: 'Tab' });
        expect(document.activeElement).toBe(closer.element);
        await panel.trigger('keydown', { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(links[links.length - 1].element);

        await closer.trigger('click');
        await nextTick();
        expect(mounted.find('[data-test="why-panel"]').exists()).toBe(false);
    });
});

describe('askWhy keys', () => {
    it('every key the panel and the Ask screen can show exists in en.js', () => {
        const keys = new Set(flatKeys(en));
        const used = [...Object.values(KIND_KEYS), ...Object.values(REASON_KEYS), ...['question_required', 'unauthenticated', 'no_match', 'scope'].map(messageKey)];
        expect(used.filter((key) => !key || !keys.has(key))).toEqual([]);
    });

    it('has no key for a code it does not know', () => {
        expect(messageKey('something_new')).toBe('');
    });
});
