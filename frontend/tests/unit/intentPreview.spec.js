import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (id === 'u-priya' ? { Employee_Name: 'Priya' } : null) }),
}));

import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { LINE_KINDS, linesOf } from '@/components/molecules/IntentPreview/intentLines';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const create = (over = {}) => ({
    kind: 'task',
    title: 'Fix the login bug',
    lines: [
        { kind: 'place', project: 'Website', list: 'Sprint 4' },
        { kind: 'assignees', names: ['Priya'], others: 0 },
        { kind: 'due', date: '2026-10-09' },
        { kind: 'priority', value: 'HIGH' },
        { kind: 'description', text: 'Safari users cannot sign in.', more: false },
    ],
    ...over,
});

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const line = (kind) => wrapper.find(`[data-test="intent-line"][data-kind="${kind}"]`);
const label = (kind) => line(kind).find('dt').text();
const value = (kind) => line(kind).find('dd').text();

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a task an agent wants to create', () => {
    it('says it is a new task, its title, and each thing it will be created with on a line of its own', () => {
        mountCard(create());
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New task');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('Fix the login bug');
        expect(wrapper.findAll('[data-test="intent-line"]').map((el) => el.attributes('data-kind'))).toEqual(['place', 'assignees', 'due', 'priority', 'description']);
        expect([label('place'), value('place')]).toEqual(['Where', 'Sprint 4, in Website']);
        expect([label('assignees'), value('assignees')]).toEqual(['For', 'Priya']);
        expect([label('due'), value('due')]).toEqual(['Due', 'Oct 9, 2026']);
        expect([label('priority'), value('priority')]).toEqual(['Priority', 'High']);
        expect([label('description'), value('description')]).toEqual(['Description', 'Safari users cannot sign in.']);
    });

    it('says a subtask is one, and which task it goes under', () => {
        mountCard({ kind: 'subtask', title: 'Write the test', lines: [{ kind: 'parent', task: 'Fix the login bug' }] });
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New subtask');
        expect([label('parent'), value('parent')]).toEqual(['Under', 'Fix the login bug']);
    });

    it('names the project alone when the list is not one the person may see', () => {
        mountCard(create({ lines: [{ kind: 'place', project: 'Website', list: '' }] }));
        expect(value('place')).toBe('Website');
    });

    it('counts the people it may not name', () => {
        mountCard(create({ lines: [{ kind: 'assignees', names: ['Priya'], others: 2 }] }));
        expect(value('assignees')).toBe('Priya and 2 more');
        wrapper.unmount();
        mountCard(create({ lines: [{ kind: 'assignees', names: [], others: 1 }] }));
        expect(value('assignees')).toBe('1 person not shown');
        wrapper.unmount();
        mountCard(create({ lines: [{ kind: 'assignees', names: [], others: 3 }] }));
        expect(value('assignees')).toBe('3 people not shown');
    });

    it('shows an estimate in hours and minutes, a link count, and that a description goes on', () => {
        mountCard(create({ lines: [{ kind: 'estimate', minutes: 90 }, { kind: 'links', count: 2 }, { kind: 'description', text: 'A long story', more: true }] }));
        expect(value('estimate')).toBe('1 h 30 min');
        expect(value('links')).toBe('2 links');
        expect(value('description')).toBe('A long story…');
    });

    it('shows markup in a proposal as the text it is, and builds no element from it', () => {
        const attack = '<img src=x onerror="window.__hit = 1"><script>window.__hit = 2</script>';
        mountCard({ kind: 'task', title: attack, lines: [{ kind: 'place', project: attack, list: attack }, { kind: 'assignees', names: [attack], others: 0 }, { kind: 'description', text: attack, more: false }, { kind: 'status', name: attack }] });
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe(attack);
        expect(value('description')).toBe(attack);
        expect(value('place')).toBe(`${attack}, in ${attack}`);
        expect(value('status')).toBe(attack);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('<img');
        expect(window.__hit).toBeUndefined();
    });

    it('leaves out a line of a kind it does not know, a line with nothing to show, and anything that is not a line', () => {
        mountCard(create({ lines: [{ kind: 'automation', rule: 'When done, archive' }, { kind: 'due', date: '' }, { kind: 'place', project: '', list: 'Sprint 4' }, null, 'place', { kind: 'priority', value: 'HIGH' }] }));
        expect(wrapper.findAll('[data-test="intent-line"]').map((el) => el.attributes('data-kind'))).toEqual(['priority']);
        expect(wrapper.text()).not.toContain('When done, archive');
        expect(wrapper.text()).not.toContain('Sprint 4');
    });

    it('shows a date it cannot read as the text it was given', () => {
        mountCard(create({ lines: [{ kind: 'due', date: 'next Friday' }] }));
        expect(value('due')).toBe('next Friday');
    });

    it('has one entry per kind of line, so a later kind is one more entry', () => {
        const t = (key) => key;
        expect(Object.keys(LINE_KINDS)).toEqual(expect.arrayContaining(['place', 'parent', 'assignees', 'due', 'start', 'priority', 'status', 'type', 'estimate', 'description', 'links']));
        LINE_KINDS.view = (translate, given) => (given.name ? { label: 'View', text: given.name } : null);
        try {
            expect(linesOf(t, 'en', { lines: [{ kind: 'view', name: 'Board by owner' }] })).toEqual([{ kind: 'view', label: 'View', text: 'Board by owner' }]);
        } finally {
            delete LINE_KINDS.view;
        }
    });
});

describe('the card in a row of the Inbox approval queue', () => {
    const row = (changes, over = {}) => ({
        sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Claude', source: 'mcp', requestedBy: 'u-priya',
        what: 'task.create: Create a task in a project, with as much of it as you know in the one call', why: 'task.create via MCP', changes,
        gate: null, locked: false, editable: false, createdAt: '2026-10-01T09:00:00.000Z', unread: true, ...over,
    });
    const taskAdd = { action: 'task.add', params: { projectId: 'p-web', title: 'Fix the login bug' }, label: 'task.create via MCP', reversible: true, preview: create() };
    const mountQueue = (proposals) => {
        wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };

    it('draws the create as a card, in plain words, with Approve and Decline beside it', () => {
        mountQueue([row([taskAdd])]);
        const card = wrapper.find('[data-test="queue-row"] [data-test="intent-preview"]');
        expect(card.exists()).toBe(true);
        expect(card.find('[data-test="intent-title"]').text()).toBe('Fix the login bug');
        expect(card.text()).toContain('Website');
        expect(wrapper.find('[data-test="queue-row"] .aq__what').text()).toBe('Claude, for Priya wants to create the task “Fix the login bug”');
        expect(wrapper.find('[data-test="queue-row"] .aq__changes').text()).not.toContain('task.create');
        expect(wrapper.find('[data-test="queue-approve"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="queue-decline"]').exists()).toBe(true);
    });

    it('keeps the label line for a change that has no card', () => {
        mountQueue([row([{ action: 'task.comment', params: { taskId: 't1', body: 'Hi' }, label: 'Comment on the task', reversible: true }], { what: 'Tidy up' })]);
        expect(wrapper.find('[data-test="intent-preview"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-row"]').text()).toContain('Comment on the task');
        expect(wrapper.find('[data-test="queue-row"]').text()).toContain('Tidy up');
    });

    it('keeps the proposal\'s own words when it holds more than the one create', () => {
        mountQueue([row([taskAdd, { ...taskAdd, preview: create({ title: 'Second' }) }], { what: 'Two tasks from the meeting' })]);
        expect(wrapper.findAll('[data-test="intent-preview"]')).toHaveLength(2);
        expect(wrapper.find('[data-test="queue-row"]').text()).toContain('Two tasks from the meeting');
    });

    it('still marks a change that cannot be undone', () => {
        mountQueue([row([{ ...taskAdd, reversible: false }])]);
        expect(wrapper.find('[data-test="queue-permanent"]').exists()).toBe(true);
    });
});
