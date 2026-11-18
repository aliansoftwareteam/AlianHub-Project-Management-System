import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h, ref } from 'vue';

const { apiRequest, found } = vi.hoisted(() => ({ apiRequest: vi.fn(), found: { rows: [], descendants: [] } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/TaskInSidebar/TaskInSidebar.vue', () => ({
    default: { name: 'TaskInSidebar', props: ['data', 'task'], render() { return h('div', { class: 'candidate' }, this.data.TaskName); } }
}));

import SideBarSprintFolderData from '@/components/organisms/SideBarSprintFolderData/SideBarSprintFolderData.vue';
import { useParentRule } from '@/components/molecules/ConvertToSubTaskSidebar/parentRule';

const project = { _id: 'proj-1', taskStatusData: [] };
const moved = { _id: 'moved', TaskName: 'Moved', isParentTask: true, ProjectID: 'proj-1', sprintId: 'sprint-1', subTasks: 0 };
const row = (id, extra = {}) => ({ _id: id, TaskName: id, isParentTask: true, ProjectID: 'proj-1', sprintId: 'sprint-1', ...extra });
const sub = (id, parent, ancestors, extra = {}) => row(id, { isParentTask: false, ParentTaskId: parent, ancestors, ...extra });

const ROWS = [
    row('top'),
    sub('second', 'top', ['top']),
    sub('third', 'second', ['top', 'second']),
    moved,
    sub('own-child', 'moved', ['moved']),
    sub('own-grandchild', 'own-child', ['moved', 'own-child']),
    sub('no-chain', 'top', undefined)
];

beforeEach(() => {
    found.rows = ROWS;
    found.descendants = [];
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get') return Promise.resolve({ status: 200, data: { TaskName: 'A parent' } });
        const first = body.findQuery[0];
        if (first.$facet) return Promise.resolve({ status: 200, data: [{ results: found.rows }] });
        if (first.$match?.ancestors === 'moved') return Promise.resolve({ status: 200, data: found.descendants });
        return Promise.resolve({ status: 200, data: [] });
    });
});

async function openSprint(props) {
    const wrapper = mount(SideBarSprintFolderData, {
        props: { data: { id: 'sprint-1', name: 'Sprint 1' }, selectedProjectData: project, task: moved, ...props },
        global: { mocks: { $t: (key) => key }, provide: { $userId: ref('u1') } }
    });
    await wrapper.get('.sbf__caret--tasks').trigger('click');
    await flushPromises();
    const query = apiRequest.mock.calls.find(([, , body]) => body?.findQuery?.[0]?.$facet)[2].findQuery[0].$facet.results[0].$match.$and;
    return { names: wrapper.findAll('.candidate').map((el) => el.text()), query };
}

describe('the tasks offered as a parent', () => {
    it('are first and second level tasks, without the task itself or anything below it', async () => {
        const { names, query } = await openSprint({ parentRule: { task: moved, height: 0 } });
        expect(names).toEqual(['top', 'second']);
        expect(query[2]).toEqual({ $and: [{ $or: [{ isParentTask: true }, { ancestors: { $size: 1 } }] }, { ancestors: { $ne: 'moved' } }] });
    });

    it('are first level tasks only when the task brings subtasks', async () => {
        const { names, query } = await openSprint({ parentRule: { task: moved, height: 1 } });
        expect(names).toEqual(['top']);
        expect(query[2]).toEqual({ $and: [{ $or: [{ isParentTask: true }] }, { ancestors: { $ne: 'moved' } }] });
    });

    it('stay as they were when no single task is being placed', async () => {
        const { names, query } = await openSprint({ task: {} });
        expect(query[2]).toEqual({ isParentTask: true });
        expect(names).toEqual(ROWS.map((item) => item.TaskName));
    });
});

describe('the rule for placing one task under a parent', () => {
    const ruleFor = (task, choosing = true) => useParentRule(() => task, () => choosing);

    it('reads the subtree once and measures its height', async () => {
        found.descendants = [sub('own-child', 'moved', ['moved']), sub('own-grandchild', 'own-child', ['moved', 'own-child'])];
        const rule = ruleFor({ ...moved, subTasks: 1 });
        expect(rule.pending.value).toBe(true);
        expect(rule.rule.value).toBeNull();
        await rule.load();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest.mock.calls[0][2].findQuery[0].$match).toMatchObject({ ancestors: 'moved' });
        expect(rule.pending.value).toBe(false);
        expect(rule.rule.value).toMatchObject({ height: 2, task: { _id: 'moved' } });
        expect(rule.blocked.value).toBe(true);
    });

    it('takes a task with no subtasks as height zero', async () => {
        const rule = ruleFor(moved);
        await rule.load();
        expect(rule.rule.value.height).toBe(0);
        expect(rule.blocked.value).toBe(false);
    });

    it('counts the children of a task whose subtree has no chain yet', async () => {
        const rule = ruleFor({ ...moved, subTasks: 3 });
        await rule.load();
        expect(rule.rule.value.height).toBe(1);
    });

    it('falls back to the child count when the read fails', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        const rule = ruleFor({ ...moved, subTasks: 2 });
        await rule.load();
        expect(rule.rule.value.height).toBe(1);
    });

    it('is off for a bulk pick and outside convert', async () => {
        const bulk = ruleFor({});
        await bulk.load();
        const merge = ruleFor(moved, false);
        await merge.load();
        expect([bulk.rule.value, merge.rule.value]).toEqual([null, null]);
        expect([bulk.pending.value, merge.pending.value]).toEqual([false, false]);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
