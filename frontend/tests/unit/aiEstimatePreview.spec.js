import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { ops, stub, api } = vi.hoisted(() => ({
    ops: { updateTotalEstimatedTime: vi.fn(() => Promise.resolve()) },
    stub: (name) => ({ default: { name, render: () => null } }),
    api: { reply: null }
}));

vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (d) => String(d) }),
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, getWasabiImageLink: async (cid, image) => image || '', sanitizeInput: (text) => text }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }), getPriority: () => ({}) }),
    useMoment: () => ({ changeDateFormate: (d) => String(d) })
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve(api.reply)) }));
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

import { apiRequest } from '@/services';
import { undoToast, runUndo, dismissUndoToast } from '@/composable/useUndoToast';

const PROPOSAL = { status: true, data: { minutes: 210, optimistic: 150, pessimistic: 300, reasoning: 'Two endpoints and a form', previousMinutes: 120 } };

const task = (extra = {}) => ({
    _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', ProjectID: 'proj-1', sprintId: 'sprint-1',
    statusKey: 'st-open', statusType: 'default_active', AssigneeUserId: ['u1'], Task_Priority: 'LOW',
    DueDate: '', dueDateDeadLine: [], totalEstimatedTime: 120, ...extra
});

async function mountSide(value = task()) {
    const { default: TaskDetailRightSide } = await import('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue');
    const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }), 'settings/companyUsers': () => [] } });
    return mount(TaskDetailRightSide, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { task: value, clientWidth: 1280 },
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

async function askForEstimate(wrapper) {
    await wrapper.get('button.ai-estimate-btn').trigger('click');
    await flushPromises();
}

const proposeCalls = () => apiRequest.mock.calls.filter(([, url]) => String(url).endsWith('/ai/task-1/propose'));

beforeEach(() => {
    ops.updateTotalEstimatedTime.mockClear();
    apiRequest.mockClear();
    api.reply = { data: PROPOSAL };
});
afterEach(() => { dismissUndoToast(); document.body.innerHTML = ''; });

describe('the AI estimate', () => {
    it('labels the trigger in words', async () => {
        const wrapper = await mountSide();
        const trigger = wrapper.get('button.ai-estimate-btn');
        expect(trigger.text()).toContain('TaskPanel.ai_estimate_suggest');
        expect(trigger.attributes('aria-label')).toBeTruthy();
        expect(trigger.attributes('title')).toBeTruthy();
    });

    it('asks the propose route and shows the suggestion without writing it', async () => {
        const wrapper = await mountSide();
        await askForEstimate(wrapper);
        expect(proposeCalls()).toHaveLength(1);
        expect(apiRequest.mock.calls.some(([method, url]) => method === 'post' && String(url).endsWith('/ai/task-1'))).toBe(false);
        const preview = wrapper.get('.aip');
        expect(preview.text()).toContain('TaskPanel.ai_estimate_suggests');
        expect(preview.text()).toContain('Two endpoints and a form');
        expect(ops.updateTotalEstimatedTime).not.toHaveBeenCalled();
    });

    it('writes nothing on Cancel', async () => {
        const wrapper = await mountSide();
        await askForEstimate(wrapper);
        await wrapper.get('.aip__cancel').trigger('click');
        await flushPromises();
        expect(wrapper.find('.aip').exists()).toBe(false);
        expect(ops.updateTotalEstimatedTime).not.toHaveBeenCalled();
    });

    it('asks again on Try again', async () => {
        const wrapper = await mountSide();
        await askForEstimate(wrapper);
        await wrapper.get('.aip__retry').trigger('click');
        await flushPromises();
        expect(proposeCalls()).toHaveLength(2);
        expect(ops.updateTotalEstimatedTime).not.toHaveBeenCalled();
    });

    it('writes through the normal estimate update on Apply, with the reasoning as the reason, then offers Undo', async () => {
        const wrapper = await mountSide();
        await askForEstimate(wrapper);
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();
        expect(ops.updateTotalEstimatedTime).toHaveBeenCalledTimes(1);
        const applied = ops.updateTotalEstimatedTime.mock.calls[0][0];
        expect(applied.firebaseObj).toEqual({ totalEstimatedTime: 210 });
        expect(applied.obj.previousEstimatedTime).toBe(120);
        expect(applied.obj.reason).toContain('Two endpoints and a form');
        expect(wrapper.find('.aip').exists()).toBe(false);
        expect(undoToast.current).not.toBeNull();

        await runUndo();
        await flushPromises();
        expect(ops.updateTotalEstimatedTime).toHaveBeenCalledTimes(2);
        const undone = ops.updateTotalEstimatedTime.mock.calls[1][0];
        expect(undone.firebaseObj).toEqual({ totalEstimatedTime: 120 });
        expect(undone.obj.reason).toBeTruthy();
    });

    it('shows the server refusal and no preview', async () => {
        api.reply = { data: { status: false, statusText: 'Please add a task description before generating an AI estimate' } };
        const wrapper = await mountSide();
        await askForEstimate(wrapper);
        expect(wrapper.find('.aip').exists()).toBe(false);
        expect(ops.updateTotalEstimatedTime).not.toHaveBeenCalled();
    });
});
