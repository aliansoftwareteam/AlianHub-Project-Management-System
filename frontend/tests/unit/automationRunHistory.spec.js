import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import RunHistoryDrawer from '@/views/Automations/RunHistoryDrawer.vue';
import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const RULE = { _id: 'r1', enabled: true, sentence: 'When priority changes, comment', firedCount: 4, trigger: { type: 'event', event: 'task.priority_changed' }, steps: [] };
const TRIGGERS = [{ key: 'task.priority_changed', label: 'Task priority changes', entity: 'task' }];
const at = (iso) => new Date(iso).toISOString();

const scoped = { scope: { projectId: 'p1', sprintId: 'sp1' }, data: { TaskName: 'Fix login' } };
const RUNS = [
    {
        _id: 'run-ok', status: 'success', eventType: 'task.priority_changed', entity: { kind: 'task', id: 't1', key: 'WEB-7' }, envelope: scoped,
        startedAt: at('2026-09-20T10:00:00Z'), finishedAt: at('2026-09-20T10:00:01.250Z'),
        steps: [{ id: 's1', type: 'action', action: 'add_comment', output: { changed: true }, durationMs: 800 }, { id: 's2', type: 'action', action: 'set_status', output: { changed: false }, durationMs: 400 }],
    },
    {
        _id: 'run-stopped', status: 'stopped', eventType: 'task.priority_changed', entity: { kind: 'task', id: 't2', key: 'WEB-8' }, envelope: { ...scoped, data: { TaskName: 'Docs' } },
        startedAt: at('2026-09-20T09:00:00Z'), finishedAt: at('2026-09-20T09:00:00.040Z'),
        steps: [{ id: 's1', type: 'condition', action: null, output: { passed: false }, durationMs: 1 }],
    },
    {
        _id: 'run-failed', status: 'failed', eventType: 'task.priority_changed', entity: { kind: 'task', id: 't3', key: 'WEB-9' }, envelope: { ...scoped, data: { TaskName: '<b>bold</b>' } },
        error: '<img src=x onerror="window.pwned=1">no such status', startedAt: at('2026-09-20T08:00:00Z'), finishedAt: at('2026-09-20T08:02:00Z'),
        steps: [{ id: 's1', type: 'action', action: 'set_status', error: 'no such status', durationMs: 20 }],
    },
    {
        _id: 'run-queued', status: 'queued', eventType: 'task.priority_changed', entity: { kind: 'task', id: 't4', key: 'WEB-10' }, envelope: scoped,
        startedAt: at('2026-09-20T07:00:00Z'), steps: [],
    },
];

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const mountDrawer = async (runs = RUNS) => {
    apiRequest.mockImplementation((method, url) => (url.endsWith('/runs') ? ok(runs) : ok([])));
    const wrapper = mount(RunHistoryDrawer, {
        props: { rule: RULE, triggers: TRIGGERS, actions: [{ key: 'add_comment', label: 'Add a comment' }, { key: 'set_status', label: 'Change status' }] },
        global: { mocks: { $t: echo } },
    });
    await flushPromises();
    return wrapper;
};

describe('RunHistoryDrawer', () => {
    beforeEach(() => { apiRequest.mockReset(); openTask.mockReset(); delete window.pwned; });

    it('loads the rule\'s runs from GET /api/v2/automations/:id/runs', async () => {
        await mountDrawer();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/automations/r1/runs');
    });

    it('shows one row per run with when, trigger, task key and duration', async () => {
        const wrapper = await mountDrawer();
        const rows = wrapper.findAll('[data-test="run-row"]');
        expect(rows).toHaveLength(4);
        expect(rows[0].find('[data-test="run-when"]').text()).toBe(new Date(RUNS[0].startedAt).toLocaleString());
        expect(rows[0].find('[data-test="run-trigger"]').text()).toBe('Task priority changes');
        expect(rows[0].find('[data-test="run-task"]').text()).toContain('WEB-7');
        expect(rows[0].find('[data-test="run-task"]').text()).toContain('Fix login');
        expect(rows[0].find('[data-test="run-duration"]').text()).toBe('Automations.duration_s {"n":1.3}');
        expect(rows[1].find('[data-test="run-duration"]').text()).toBe('Automations.duration_ms {"n":40}');
        expect(rows[2].find('[data-test="run-duration"]').text()).toBe('Automations.duration_min {"n":2}');
        expect(rows[3].find('[data-test="run-duration"]').text()).toBe('—');
    });

    it('names the outcome: actions applied, skipped with its reason, failed with its error, still running', async () => {
        const wrapper = await mountDrawer();
        const outcome = (i) => wrapper.findAll('[data-test="run-row"]')[i].find('[data-test="run-outcome"]');
        expect(outcome(0).text()).toContain('Automations.outcome_applied');
        expect(outcome(0).text()).toContain('Add a comment');
        expect(outcome(0).text()).toContain('Change status');
        expect(outcome(0).text()).toContain('Automations.step_no_change');
        expect(outcome(1).text()).toContain('Automations.outcome_skipped');
        expect(outcome(1).text()).toContain('Automations.stopped_at_condition {"id":"s1"}');
        expect(outcome(2).text()).toContain('Automations.outcome_failed');
        expect(outcome(2).text()).toContain('no such status');
        expect(outcome(3).text()).toContain('Automations.outcome_queued');
    });

    it('opens the task when its key is clicked', async () => {
        const wrapper = await mountDrawer();
        await wrapper.findAll('[data-test="run-task"]')[0].find('button').trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', projectId: 'p1', sprintId: 'sp1' }));
    });

    it('renders run text as text, never as markup', async () => {
        const wrapper = await mountDrawer();
        const failed = wrapper.findAll('[data-test="run-row"]')[2];
        expect(failed.find('img').exists()).toBe(false);
        expect(failed.find('b').exists()).toBe(false);
        expect(failed.text()).toContain('<img src=x');
        expect(failed.text()).toContain('<b>bold</b>');
        expect(window.pwned).toBeUndefined();
    });

    it('says so when the rule has not run yet, and when the list stops at the endpoint limit', async () => {
        expect((await mountDrawer([])).find('[data-test="runs-empty"]').text()).toBe('Automations.runs_empty');
        const many = Array.from({ length: 50 }, (_, i) => ({ ...RUNS[0], _id: `run-${i}` }));
        expect((await mountDrawer(many)).find('[data-test="runs-limit"]').text()).toBe('Automations.runs_limit {"n":50}');
    });

    it('emits close', async () => {
        const wrapper = await mountDrawer();
        await wrapper.find('[data-test="runs-close"]').trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});

describe('AutomationsPage run history', () => {
    const open = async (roleType) => {
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/registry')) return ok({ triggers: TRIGGERS, conditionFields: [], actions: [], operators: {} });
            if (url.endsWith('/automations')) return ok([RULE]);
            if (url.endsWith('/runs')) return ok(RUNS);
            return ok([]);
        });
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
        const wrapper = mount(AutomationsPage, { global: { plugins: [store] } });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => { apiRequest.mockReset(); });

    it.each([[1, 'owner'], [3, 'member']])('lets a roleType %i (%s) who can see the rules open a rule\'s history', async (roleType) => {
        const wrapper = await open(roleType);
        expect(wrapper.find('[data-test="runs-drawer"]').exists()).toBe(false);
        await wrapper.find('[data-test="open-runs"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/automations/r1/runs');
        expect(wrapper.findAll('[data-test="run-row"]')).toHaveLength(4);
    });
});
