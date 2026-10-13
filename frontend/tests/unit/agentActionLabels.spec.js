import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest, sendProposalDecision, route } = vi.hoisted(() => ({ apiRequest: vi.fn(), sendProposalDecision: vi.fn(), route: { query: {} } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import { agentActionLabel, changeLabel } from '@/views/Ai/agentActionLabels';

const words = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = words().global.t;

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the plain label of an agent action', () => {
    it('is read from the locale by the action\'s key', () => {
        expect(agentActionLabel(t, 'task.status.set', 'Set status (In progress / In review only)')).toBe(en.AgentActions.task_status_set);
        expect(agentActionLabel(t, 'goal.target.sources.add', '')).toBe(en.AgentActions.goal_target_sources_add);
        expect(en.AgentActions.task_status_set).not.toMatch(/[()/]/);
    });

    it('falls back to the label it was handed for an action with no words yet', () => {
        expect(agentActionLabel(t, 'something.new', 'Do a new thing')).toBe('Do a new thing');
        expect(agentActionLabel(t, 'something.new', '')).toBe('');
        expect(agentActionLabel(t, '', 'Kept')).toBe('Kept');
    });

    it('words only a change that came with no words of its own', () => {
        expect(changeLabel(t, { action: 'task.comment', label: 'Comment on a task', stockLabel: true })).toBe(en.AgentActions.task_comment);
        expect(changeLabel(t, { action: 'task.comment', label: 'Comment on AP-1: "Ship it"' })).toBe('Comment on AP-1: "Ship it"');
        expect(changeLabel(t, { action: 'something.new', label: 'something.new via MCP', stockLabel: true })).toBe('something.new via MCP');
    });
});

describe('an approval card in the Inbox', () => {
    const change = (over = {}) => ({ action: 'task.archive', params: { taskId: 't1' }, label: 'task.archive via MCP', reversible: true, stockLabel: true, ...over });
    const row = (over = {}) => ({
        sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Claude (MCP)', source: 'mcp', requestedBy: '',
        what: 'task.archive: Archive a task with its subtasks', why: 'Asked to', changes: [change()], gate: null, locked: false, editable: false,
        createdAt: '2026-10-02T09:00:00.000Z', unread: true, ...over,
    });
    const mountQueue = (proposals) => { wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [words()], stubs: { ShellIcon: true } } }); };
    const labels = () => wrapper.findAll('.aq__change-label').map((line) => line.text());

    it('words a change that has no preview and no words of its own', () => {
        mountQueue([row()]);
        expect(labels()).toEqual([en.AgentActions.task_archive]);
        expect(wrapper.find('[data-test="queue-row"] .aq__changes').text()).not.toContain('via MCP');
    });

    it('keeps the words a change was filed with', () => {
        mountQueue([row({ source: '', editable: true, changes: [change({ label: 'Archive AP-7, done last month', stockLabel: false })] })]);
        expect(labels()).toEqual(['Archive AP-7, done last month']);
    });

    it('names the kind of change in "Always do this" in the same words', async () => {
        mountQueue([row({ always: true, alwaysKind: 'Archive a task with its subtasks' })]);
        await wrapper.find('[data-test="queue-always"]').trigger('click');
        const panel = wrapper.find('[data-test="queue-always-panel"]').text();
        expect(panel).toContain(en.AgentActions.task_archive);
        expect(panel).not.toContain('Archive a task with its subtasks');
    });
});

describe('an agent\'s row in the audit log', () => {
    const agentRow = (action, over = {}) => ({
        _id: `row-${action}`, action: 'agent.action', actorId: 'u1', actorName: 'Ada', createdAt: new Date().toISOString(), entityName: 'Fix login',
        meta: { actorType: 'agent', agentName: 'Claude', action, reason: 'Asked to' }, ...over,
    });
    const open = async (rows) => {
        apiRequest.mockResolvedValue({ data: { status: true, data: rows, metadata: { total: rows.length, page: 1, totalPages: 1 } } });
        const i18n = words();
        wrapper = mount(AuditLog, { global: { plugins: [i18n], mocks: { $t: i18n.global.t } } });
        await flushPromises();
    };
    const events = () => wrapper.findAll('.al__action');

    beforeEach(() => { apiRequest.mockReset(); route.query = {}; });

    it('says what the agent did in plain words, and keeps the action\'s key for whoever needs it', async () => {
        await open([agentRow('task.status.set')]);
        expect(events()[0].text()).toBe(en.AgentActions.task_status_set);
        expect(events()[0].attributes('title')).toBe('task.status.set');
        expect(events()[0].classes()).not.toContain('ah-mono');
    });

    it('words an action that only reads, and a person\'s row, with the key on hover', async () => {
        await open([agentRow('tasks.search'), { _id: 'r2', action: 'member.update', actorId: 'u1', actorName: 'Ada', createdAt: new Date().toISOString(), meta: {} }]);
        expect(events().map((event) => event.text())).toEqual([en.AgentActions.tasks_search, en.AuditEvents.member_update]);
        expect(events().map((event) => event.attributes('title'))).toEqual(['tasks.search', 'member.update']);
        expect(events().some((event) => event.classes().includes('ah-mono'))).toBe(false);
    });
});
