/* Task 046 M3, slice G6: the task panel's "Counts toward" row. It asks the server which goal targets
   count the task (the server answers only with goals this person can read) and shows a chip for
   each; with none, or for a task the server will not answer for, there is no row. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';
import en from '@/locales/en';

const { apiRequest, router } = vi.hoisted(() => ({ apiRequest: vi.fn(), router: { hasRoute: vi.fn(() => true) } }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRouter: () => router }));

import TaskGoals from '@/components/organisms/TaskDetailOverlay/TaskGoals.vue';

const CID = 'company-1';
const TASK = '6f0000000000000000000d01';
const OTHER_TASK = '6f0000000000000000000d02';
const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' };
const row = (n, over = {}) => ({
    goalId: `goal-${n}`, goalName: `Goal ${n}`, color: '', progressPct: n * 10, targetId: `target-${n}`, targetName: `Target ${n}`, targetProgressPct: n * 20, through: 'list', ...over,
});
const answer = (data) => Promise.resolve({ data: { status: true, statusText: 'Goals fetched successfully.', data } });
const refused = (status) => Promise.reject({ response: { status, data: { status: false, statusText: 'Task not found.', message: 'Task not found.' } } });

let wrapper;
const show = async (taskId = TASK) => {
    wrapper = mount(TaskGoals, { props: { taskId }, global: { provide: { $companyId: ref(CID) }, stubs: { RouterLink } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const group = () => wrapper.find('[data-test="task-goals"]');
const chips = () => wrapper.findAll('[data-test="task-goal"]');

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    apiRequest.mockReset();
    router.hasRoute.mockImplementation(() => true);
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('the goals a task counts toward, in the task panel', () => {
    it('asks for the task\'s goals once, by the task\'s id', async () => {
        apiRequest.mockImplementation(() => answer([row(1)]));
        await show();
        expect(apiRequest.mock.calls).toEqual([['get', `/api/v2/goals/for-task/${TASK}`]]);
    });

    it('shows a chip for each target that counts the task, linked to its goal', async () => {
        apiRequest.mockImplementation(() => answer([row(1, { goalName: 'Launch the site', targetName: 'Launch tasks', progressPct: 25 }), row(2), row(3, { goalId: 'goal-2', targetId: 'target-3' })]));
        await show();
        expect(group().find('.ah-label').text()).toBe('Counts toward');
        expect(chips()).toHaveLength(3);
        const [first, , third] = chips();
        expect(first.find('.tgl__goal').text()).toBe('Launch the site');
        expect(first.find('.tgl__target').text()).toBe('Launch tasks');
        expect(first.find('.tgl__pct').text()).toBe('25%');
        expect(first.attributes('aria-label')).toBe('Launch tasks, a target of the goal Launch the site, which is 25% reached');
        expect(JSON.parse(first.attributes('data-to'))).toEqual({ name: 'Goal', params: { cid: CID, goalId: 'goal-1' } });
        expect(JSON.parse(third.attributes('data-to'))).toEqual({ name: 'Goal', params: { cid: CID, goalId: 'goal-2' } });
    });

    it('shows the chips without links in a build that has no goal page', async () => {
        router.hasRoute.mockImplementation(() => false);
        apiRequest.mockImplementation(() => answer([row(1)]));
        await show();
        expect(router.hasRoute).toHaveBeenCalledWith('Goal');
        expect(chips()).toHaveLength(1);
        expect(chips()[0].element.tagName).toBe('SPAN');
        expect(chips()[0].attributes('data-to')).toBeUndefined();
        expect(chips()[0].find('.tgl__goal').text()).toBe('Goal 1');
    });

    it('has no row when no goal counts the task', async () => {
        apiRequest.mockImplementation(() => answer([]));
        await show();
        expect(group().exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });

    it.each([404, 403, 500])('has no row when the server answers %s for the task', async (status) => {
        apiRequest.mockImplementation(() => refused(status));
        await show();
        expect(group().exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });

    it('has nothing to add or remove a goal with', async () => {
        apiRequest.mockImplementation(() => answer([row(1)]));
        await show();
        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(wrapper.findAll('input')).toHaveLength(0);
    });

    it('reads again when the panel moves to another task, and never shows the last task\'s goals on it', async () => {
        let late;
        apiRequest.mockImplementationOnce(() => answer([row(1)]));
        await show();
        expect(chips()).toHaveLength(1);

        apiRequest.mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
        await wrapper.setProps({ taskId: OTHER_TASK });
        expect(group().exists()).toBe(false);
        expect(apiRequest).toHaveBeenLastCalledWith('get', `/api/v2/goals/for-task/${OTHER_TASK}`);

        apiRequest.mockImplementationOnce(() => answer([]));
        await wrapper.setProps({ taskId: TASK });
        await flushPromises();
        late({ data: { status: true, data: [row(9)] } });
        await flushPromises();
        expect(group().exists()).toBe(false);
    });
});

describe('the task panel', () => {
    const panel = fs.readFileSync(path.resolve(__dirname, '../../src/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue'), 'utf8');

    it('holds the row under its relations, for a task that is loaded', () => {
        const relations = panel.indexOf("$t('TaskPanel.no_relations')");
        const goalsRow = panel.indexOf('<TaskGoals v-if="task._id" :task-id="task._id" />');
        expect(relations).toBeGreaterThan(-1);
        expect(goalsRow).toBeGreaterThan(relations);
        expect(goalsRow).toBeLessThan(panel.indexOf('class="ah-detail__foot'));
    });
});
