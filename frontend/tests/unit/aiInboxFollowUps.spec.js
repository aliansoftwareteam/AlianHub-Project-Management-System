import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';
import en from '@/locales/en';

const PROJECT = '64b000000000000000000001';
const TWENTY = 20;
const task = (n) => ({ taskId: `t${n}`, name: `Bulk ${n}`, projectId: 'p1', sprintId: 's1', folderId: '' });
const statusChange = (n) => ({ action: 'task.status.change', params: { taskId: `t${n}`, status: { name: 'To Do' } }, label: 'task.status.set via MCP', reversible: true, stockLabel: true });
const proposal = (over = {}) => ({ _id: 'pr1', agentName: 'Claude (MCP)', source: 'mcp', requestedBy: 'user-1', what: 'A batch of 20 changes', why: 'Back to the start of the week', status: 'pending', createdAt: new Date().toISOString(), ...over });
const batchOf = () => proposal({
    changes: Array.from({ length: TWENTY }, (unused, at) => statusChange(at + 1)),
    batch: {
        kind: 'batch', tasks: TWENTY, changes: TWENTY,
        lines: [{ kind: 'batchChange', what: 'status', count: TWENTY, value: 'To Do', mixed: false }, { kind: 'batchTasks', tasks: [1, 2, 3, 4, 5].map(task), others: TWENTY - 5 }],
    },
});

let seen;
let listedRows;
let wrapper;

const store = () => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
    projectData: { namespaced: true, mutations: { mutateProjects: (state, payload) => { seen.push(payload); } } },
} });

const ok = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
const posts = () => apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url, body]) => [url, body]);

const open = async () => {
    const words = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(AiInbox, { attachTo: document.body, global: { plugins: [store(), words], mocks: { $t: words.global.t } } });
    await flushPromises();
    await wrapper.find('.ai-item').trigger('click');
};

beforeEach(() => {
    seen = [];
    listedRows = [batchOf()];
    apiRequest.mockReset();
    openTask.mockReset();
    apiRequest.mockImplementation((type, url) => {
        if (type === 'get' && url === `/api/v1/project/${PROJECT}`) return Promise.resolve({ data: { _id: PROJECT, ProjectName: 'Launch' } });
        if (type === 'get' && url.includes('/proposals')) return ok(listedRows, { counts: { waiting: listedRows.length } });
        return ok({});
    });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('a waiting batch on the AI Inbox page', () => {
    it('is one row that says how much it changes, not the name of a tool', async () => {
        await open();
        expect(wrapper.findAll('.ai-item')).toHaveLength(1);
        expect(wrapper.find('.ai-item__what').text()).toBe('Several tasks: 20 tasks');
        expect(wrapper.find('.ai-detail__what').text()).toBe('Several tasks: 20 tasks');
    });

    it('is the same one card the Inbox shows, not a line for each change', async () => {
        await open();
        expect(wrapper.findAll('.ai-change')).toHaveLength(0);
        expect(wrapper.findAll('[data-test="intent-preview"]')).toHaveLength(1);
        const lines = wrapper.findAll('[data-test="intent-line"]').map((line) => [line.find('dt').text(), line.find('dd').text().replace(/\s+/g, ' ')]);
        expect(lines).toEqual([['Status', 'To Do, on 20 tasks'], ['Tasks', 'Bulk 1Bulk 2Bulk 3Bulk 4Bulk 5 and 15 more']]);
        expect(wrapper.text()).not.toContain('via MCP');
    });

    it('opens a task named on the card', async () => {
        await open();
        await wrapper.findAll('[data-test="intent-open-task"]')[1].trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't2', projectId: 'p1', sprintId: 's1', companyId: 'company-1' }));
    });

    it('is approved whole with one call, and offers no change-by-change edit', async () => {
        await open();
        expect(wrapper.find('[data-test="edit-then-approve"]').exists()).toBe(false);
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([['/api/v2/agents/proposals/pr1/approve', {}]]);
    });

    it('marks the card when one of its changes cannot be undone', async () => {
        listedRows = [{ ...batchOf(), changes: [statusChange(1), { ...statusChange(2), reversible: false }] }];
        await open();
        expect(wrapper.findAll('[data-test="batch-permanent"]')).toHaveLength(1);
    });
});

describe('a proposal that is not a batch', () => {
    it('keeps one line for each change, and offers the edit', async () => {
        listedRows = [proposal({ source: '', what: 'Tidy the task', changes: [{ action: 'task.comment', label: 'Comment on AP-1: "x"', reversible: true }, { action: 'task.update', label: 'Move AP-1 2 days later', reversible: true }] })];
        await open();
        expect(wrapper.find('.ai-item__what').text()).toBe('Tidy the task');
        expect(wrapper.findAll('.ai-change__label').map((line) => line.text())).toEqual(['Comment on AP-1: "x"', 'Move AP-1 2 days later']);
        expect(wrapper.find('[data-test="intent-preview"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="edit-then-approve"]').exists()).toBe(true);
    });

    it('words a change that came with no words of its own', async () => {
        listedRows = [proposal({ what: 'task.status.set: Set the status of a task', changes: [statusChange(1)] })];
        await open();
        expect(wrapper.findAll('.ai-change__label').map((line) => line.text())).toEqual([en.AgentActions.task_status_change]);
    });
});

describe('approving a new project on the AI Inbox page', () => {
    const made = { action: 'project.create', ok: true, result: { projectId: PROJECT, name: 'Launch' } };
    const approve = async () => {
        await wrapper.find('.ai-actions .ah-btn--primary').trigger('click');
        await flushPromises();
    };

    beforeEach(() => {
        listedRows = [proposal({ what: 'project.create', changes: [{ action: 'project.create', params: { name: 'Launch' }, label: 'project.create via MCP', reversible: true, stockLabel: true }] })];
        const answers = { approve: { applied: [made], undoUntil: new Date(Date.now() + 60000).toISOString(), decidedBy: 'user-1' }, undo: { results: [{ auditId: 'a1', ok: true, result: { projectId: PROJECT, name: 'Launch', trashed: true } }] } };
        const answer = apiRequest.getMockImplementation();
        apiRequest.mockImplementation((type, url, body) => (type === 'post' ? ok(answers[url.split('/').pop()] || {}) : answer(type, url, body)));
    });

    it('shows the project without a reload', async () => {
        await open();
        await approve();
        expect(seen).toEqual([[{ snap: null, privateSnap: false, op: 'added', data: { _id: PROJECT, ProjectName: 'Launch', id: PROJECT, isExpanded: false } }]]);
    });

    it('takes it away again when Undo moves it to the trash', async () => {
        await open();
        await approve();
        await wrapper.find('.ah-toolbar .ah-chip--ok button').trigger('click');
        await flushPromises();
        expect(posts().map(([url]) => url.split('/').pop())).toEqual(['approve', 'undo']);
        expect(seen[1]).toEqual([{ op: 'removed', data: { _id: PROJECT } }]);
    });
});
