import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { ops, stub, apps } = vi.hoisted(() => ({
    ops: {
        updateStatus: vi.fn(() => Promise.resolve()),
        updateAssignee: vi.fn(() => Promise.resolve()),
        updatePriority: vi.fn(() => Promise.resolve()),
        updateDueDate: vi.fn(() => Promise.resolve())
    },
    stub: (name) => ({ default: { name, render: () => null } }),
    apps: { MultipleAssignees: true, Priority: true }
}));

vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (d) => String(d) }),
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: (name) => Boolean(apps[name]), getWasabiImageLink: async (cid, image) => image || '', sanitizeInput: (text) => text }),
    useGetterFunctions: () => ({
        getUser: (id) => ({ id, Employee_Name: `Name ${id}` }),
        getPriority: (value) => ({ LOW: { name: 'Low', image: 'low.png', value: 'LOW' }, HIGH: { name: 'High', image: 'high.png', value: 'HIGH' } }[value] || {})
    }),
    useMoment: () => ({ changeDateFormate: (d) => String(d) })
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/utils/trackerDeepLink', () => ({ openInTracker: vi.fn(() => ({ ok: true })), isTrackerCapableDevice: () => true }));
for (const [path, name] of [
    ['@/components/molecules/EstimateHours/EstimateHours.vue', 'EstimateHours'],
    ['@/components/molecules/EstimatedTimeInput/EstimatedTimeInput.vue', 'EstimatedTimeInput'],
    ['@/components/molecules/TaskStatus/TaskStatus.vue', 'TaskStatus'],
    ['@/components/molecules/Assignee/Assignee.vue', 'Assignee'],
    ['@/components/atom/UserProfile/UserProfile.vue', 'UserProfile'],
    ['@/components/molecules/PriorityCompo/PriorityComp.vue', 'PriorityComp'],
    ['@/components/atom/StoryPoints/StoryPoints.vue', 'StoryPoints'],
    ['@/components/molecules/DueDateCompo/DueDateCompo.vue', 'DueDateCompo'],
    ['@/components/atom/Skelaton/Skelaton.vue', 'Skelaton'],
    ['@/components/atom/Modal/Modal.vue', 'Modal']
]) vi.doMock(path, () => stub(name));

import { undoToast, runUndo, dismissUndoToast } from '@/composable/useUndoToast';

const DUE = new Date('2026-10-01T00:00:00.000Z');
const PREV_DUE = new Date('2026-09-15T00:00:00.000Z');
const OPEN = { key: 'st-open', name: 'Open', type: 'default_active', value: 'open', bgColor: '#eee', textColor: '#000' };
const REVIEW = { key: 'st-review', name: 'In review', type: 'active', value: 'review', bgColor: '#ffd', textColor: '#000' };

const baseTask = (extra = {}) => ({
    _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', ProjectID: 'proj-1', sprintId: 'sprint-1',
    statusKey: 'st-open', statusType: 'default_active', AssigneeUserId: ['u1'], Task_Priority: 'LOW',
    DueDate: '', dueDateDeadLine: [], ...extra
});

async function mountSide(task) {
    const { default: TaskDetailRightSide } = await import('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue');
    const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }), 'settings/companyUsers': () => [] } });
    return mount(TaskDetailRightSide, {
        props: { task, clientWidth: 1280 },
        global: {
            plugins: [store],
            provide: {
                $userId: ref('u1'),
                $dateFormat: ref('DD/MM/YYYY'),
                selectedProject: ref({ _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Launch', ProjectCode: 'AH', lastTaskId: 1, isGlobalPermission: false })
            }
        }
    });
}

const lastCall = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

beforeEach(() => {
    Object.values(ops).forEach((fn) => fn.mockClear());
    apps.MultipleAssignees = true;
});
afterEach(() => dismissUndoToast());

describe('undo in the task panel', () => {
    it('offers undo for a status change and restores the previous status through the same update', async () => {
        const wrapper = await mountSide(baseTask());
        wrapper.findComponent({ name: 'TaskStatus' }).vm.$emit('update:status', OPEN, REVIEW);
        await flushPromises();
        expect(lastCall(ops.updateStatus).newStatus).toMatchObject({ statusKey: 'st-review' });
        expect(undoToast.current).not.toBeNull();
        await runUndo();
        await flushPromises();
        expect(ops.updateStatus).toHaveBeenCalledTimes(2);
        const undo = lastCall(ops.updateStatus);
        expect(undo.newStatus).toMatchObject({ statusKey: 'st-open', statusType: 'default_active', status: { key: 'st-open', text: 'Open' } });
        expect(undo.prevStatus).toMatchObject({ statusName: 'In review', updatedTaskName: 'Open' });
        expect(undoToast.current).toBeNull();
    });

    it('undoes an added assignee by removing them', async () => {
        const wrapper = await mountSide(baseTask());
        wrapper.findComponent({ name: 'Assignee' }).vm.$emit('selected', { id: 'u2' });
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'assigneeAdd', firebaseObj: { AssigneeUserId: 'u2' } });
        await runUndo();
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'assigneRemove', firebaseObj: { AssigneeUserId: 'u2' } });
    });

    it('undoes a removed assignee by adding them back', async () => {
        const wrapper = await mountSide(baseTask({ AssigneeUserId: ['u1', 'u2'] }));
        wrapper.findComponent({ name: 'Assignee' }).vm.$emit('removed', { id: 'u2' });
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'assigneRemove', firebaseObj: { AssigneeUserId: 'u2' } });
        await runUndo();
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'assigneeAdd', firebaseObj: { AssigneeUserId: 'u2' } });
    });

    it('undoes a replaced single assignee by putting the previous one back', async () => {
        apps.MultipleAssignees = false;
        const wrapper = await mountSide(baseTask({ AssigneeUserId: ['u1'] }));
        wrapper.findComponent({ name: 'Assignee' }).vm.$emit('selected', { id: 'u2' });
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'replace', firebaseObj: { AssigneeUserId: 'u2' } });
        await runUndo();
        await flushPromises();
        expect(lastCall(ops.updateAssignee)).toMatchObject({ type: 'replace', firebaseObj: { AssigneeUserId: 'u1' } });
    });

    it('undoes a priority change', async () => {
        const wrapper = await mountSide(baseTask());
        wrapper.findComponent({ name: 'PriorityComp' }).vm.$emit('select', { value: 'HIGH', name: 'High', statusImage: 'high.png' });
        await flushPromises();
        expect(lastCall(ops.updatePriority).firebaseObj).toEqual({ Task_Priority: 'HIGH' });
        await runUndo();
        await flushPromises();
        const undo = lastCall(ops.updatePriority);
        expect(undo.firebaseObj).toEqual({ Task_Priority: 'LOW' });
        expect(undo.priorityObj).toMatchObject({ priorityName: 'High', newPriorityName: 'Low' });
    });

    it('undoes a first due date by clearing it', async () => {
        const wrapper = await mountSide(baseTask());
        const due = wrapper.findAllComponents({ name: 'DueDateCompo' }).find((c) => c.vm.$attrs.label === 'Projects.due_date');
        due.vm.$emit('SelectedDate', { dateVal: DUE });
        await flushPromises();
        expect(lastCall(ops.updateDueDate).firebaseObj.DueDate).toEqual(DUE);
        await runUndo();
        await flushPromises();
        expect(lastCall(ops.updateDueDate).firebaseObj).toEqual({ DueDate: null, dueDateDeadLine: [] });
    });

    it('undoes a changed due date by restoring the previous date and deadline list', async () => {
        const wrapper = await mountSide(baseTask({ DueDate: PREV_DUE, dueDateDeadLine: [{ date: PREV_DUE }] }));
        const due = wrapper.findAllComponents({ name: 'DueDateCompo' }).find((c) => c.vm.$attrs.label === 'Projects.due_date');
        due.vm.$emit('SelectedDate', { dateVal: DUE });
        await flushPromises();
        await runUndo();
        await flushPromises();
        const undo = lastCall(ops.updateDueDate).firebaseObj;
        expect(new Date(undo.DueDate).toISOString()).toBe(PREV_DUE.toISOString());
        expect(undo.dueDateDeadLine.map((x) => new Date(x.date).toISOString())).toEqual([PREV_DUE.toISOString()]);
    });

    it('offers no second undo after undoing', async () => {
        const wrapper = await mountSide(baseTask());
        wrapper.findComponent({ name: 'PriorityComp' }).vm.$emit('select', { value: 'HIGH', name: 'High', statusImage: 'high.png' });
        await flushPromises();
        await runUndo();
        await flushPromises();
        expect(undoToast.current).toBeNull();
    });

    it('has no desktop-tracker start button beside the timer', async () => {
        const wrapper = await mountSide(baseTask());
        expect(wrapper.find('.start-in-tracker-btn').exists()).toBe(false);
    });
});
