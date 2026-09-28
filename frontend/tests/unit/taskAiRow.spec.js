import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { ops, api, perms } = vi.hoisted(() => ({
    ops: {
        updateAiChecklist: vi.fn(() => Promise.resolve({ status: true })),
        updateChecklistsv2: vi.fn(() => Promise.resolve({ status: true })),
        createSubTaskWithAi: vi.fn(() => Promise.resolve({ status: true, data: [{ _id: 'new-1', TaskName: 'Write the FAQ', ProjectID: 'proj-1', sprintId: 'sprint-1' }] })),
        updateArchiveDelete: vi.fn(() => Promise.resolve({ status: true }))
    },
    api: { replies: {} },
    perms: { value: true }
}));

vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => perms.value, checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }) })
}));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => Promise.resolve(api.replies[url] || { data: { status: false } }))
}));

import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import TaskAiRow from '@/components/organisms/TaskDetailOverlay/TaskAiRow.vue';
import { resetTaskAiCapabilities } from '@/components/organisms/TaskDetailOverlay/taskAiCapabilities';
import en from '@/locales/en.js';

config.global.plugins[0].global.setLocaleMessage('en', en);
const t = config.global.plugins[0].global.t;

const TASK = { _id: 'task-1', TaskName: 'Launch pricing', TaskKey: 'AH-1', ProjectID: 'proj-1', sprintId: 'sprint-1', sprintArray: { id: 'sprint-1', name: 'Sprint 1' }, checklistArray: [] };
const PROJECT = { _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Growth', ProjectCode: 'GR', lastTaskId: 3, isGlobalPermission: false, apps: ['AI'] };

const ok = (data) => ({ data: { status: true, data } });

function mountRow(props = {}) {
    const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }) } });
    return mount(TaskAiRow, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { task: TASK, project: PROJECT, canComment: true, ...props },
        global: {
            plugins: [store],
            mocks: { $t: t },
            provide: { $userId: ref('u1'), $companyId: ref('company-1') }
        }
    });
}

beforeEach(() => {
    resetAiAvailability();
    resetTaskAiCapabilities();
    applyAiAvailability({ state: AI_STATE.ON, planAllowsAi: true, loaded: true });
    perms.value = true;
    api.replies = { [env.AI_TASK_ASSIST]: ok({ research: false }) };
    Object.values(ops).forEach((fn) => fn.mockClear());
    apiRequest.mockClear();
});
afterEach(() => { dismissUndoToast(); document.body.innerHTML = ''; });

describe('the AI row under the task title', () => {
    it('shows Ask about this task and Suggest next steps while AI is usable', async () => {
        const wrapper = mountRow();
        await flushPromises();
        expect(wrapper.find('[data-test="task-ai-row"]').exists()).toBe(true);
        expect(wrapper.find('[data-action="ask"]').text()).toBe(t('TaskAi.ask'));
        expect(wrapper.find('[data-action="steps"]').text()).toBe(t('TaskAi.next_steps'));
    });

    it('is not there while AI is off or unconfigured', async () => {
        for (const state of [AI_STATE.OFF_INSTANCE, AI_STATE.OFF_WORKSPACE, AI_STATE.UNCONFIGURED]) {
            applyAiAvailability({ state });
            const wrapper = mountRow();
            await flushPromises();
            expect(wrapper.find('[data-test="task-ai-row"]').exists()).toBe(false);
            wrapper.unmount();
        }
    });

    it('is not there when the plan allows no AI or the project has the AI app off', async () => {
        applyAiAvailability({ state: AI_STATE.ON, planAllowsAi: false });
        const noPlan = mountRow();
        await flushPromises();
        expect(noPlan.find('[data-test="task-ai-row"]').exists()).toBe(false);
        noPlan.unmount();

        applyAiAvailability({ planAllowsAi: true });
        const noApp = mountRow({ project: { ...PROJECT, apps: [] } });
        await flushPromises();
        expect(noApp.find('[data-test="task-ai-row"]').exists()).toBe(false);
    });

    it('offers Research this only when the instance allows web research', async () => {
        const hidden = mountRow();
        await flushPromises();
        expect(hidden.find('[data-action="research"]').exists()).toBe(false);
        hidden.unmount();

        resetTaskAiCapabilities();
        api.replies[env.AI_TASK_ASSIST] = ok({ research: true });
        const shown = mountRow();
        await flushPromises();
        expect(shown.find('[data-action="research"]').text()).toBe(t('TaskAi.research'));
    });
});

describe('Ask about this task', () => {
    it('asks the Ask API with this task as its context and shows the answer', async () => {
        api.replies[env.AI_ASK] = ok({ configured: true, answer: 'Legal approved it [AH-1].', cited: [{ kind: 'task', ref: 'AH-1', title: 'Launch pricing' }] });
        const wrapper = mountRow();
        await flushPromises();
        await wrapper.get('[data-action="ask"]').trigger('click');
        await wrapper.get('[data-test="task-ask-input"]').setValue('Is this ready?');
        await wrapper.get('[data-test="task-ask-form"]').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_ASK, { question: 'Is this ready?', taskId: 'task-1' });
        expect(wrapper.get('[data-test="task-ask-answer"]').text()).toContain('Legal approved it');
        expect(wrapper.text()).toContain('Launch pricing');
    });
});

describe('Suggest next steps', () => {
    const STEPS = ['Confirm prices with finance', 'Write the FAQ', 'Book the launch review'];

    async function openSteps() {
        api.replies[env.AI_TASK_NEXT_STEPS] = ok({ steps: STEPS });
        const wrapper = mountRow();
        await flushPromises();
        await wrapper.get('[data-action="steps"]').trigger('click');
        await flushPromises();
        return wrapper;
    }

    it('previews the steps and writes nothing until a person applies them', async () => {
        const wrapper = await openSteps();
        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_TASK_NEXT_STEPS, { taskId: 'task-1' });
        expect(wrapper.findAll('[data-test="ai-step"]').map((row) => row.text())).toEqual(STEPS);
        expect(wrapper.get('.aip__replace').text()).toBe(t('TaskAi.add_checklist'));
        expect(wrapper.get('.aip__insert').text()).toBe(t('TaskAi.add_subtasks'));
        expect(wrapper.find('.aip__copy').exists()).toBe(true);
        Object.values(ops).forEach((fn) => expect(fn).not.toHaveBeenCalled());
        await wrapper.get('.aip__cancel').trigger('click');
        expect(wrapper.find('.aip').exists()).toBe(false);
        Object.values(ops).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('adds the checked steps as one checklist through the normal checklist path, with undo', async () => {
        const wrapper = await openSteps();
        await wrapper.findAll('[data-test="ai-step"] input')[1].setValue(false);
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();
        expect(ops.updateAiChecklist).toHaveBeenCalledTimes(1);
        const sent = ops.updateAiChecklist.mock.calls[0][0];
        expect(sent).toMatchObject({ companyId: 'company-1', taskId: 'task-1', sprintId: 'sprint-1', projectId: 'proj-1' });
        const [head, ...items] = sent.checklistArray;
        expect(head).toMatchObject({ name: t('TaskAi.checklist_name'), isChecked: false });
        expect(head.parentId).toBeUndefined();
        expect(items.map((item) => item.name)).toEqual(['Confirm prices with finance', 'Book the launch review']);
        items.forEach((item) => expect(item.parentId).toBe(head.id));
        expect(wrapper.find('.aip').exists()).toBe(false);

        expect(undoToast.current).not.toBeNull();
        await runUndo();
        expect(ops.updateChecklistsv2).toHaveBeenCalledWith(expect.objectContaining({ ops: 'checklistremove', taskId: 'task-1', data: sent.checklistArray.map((item) => item.id) }));
    });

    it('adds the steps as subtasks through the normal subtask path, with undo to trash', async () => {
        const wrapper = await openSteps();
        await wrapper.get('.aip__insert').trigger('click');
        await flushPromises();
        expect(ops.createSubTaskWithAi).toHaveBeenCalledWith(expect.objectContaining({
            type: 'subTask',
            parentTask: { id: 'task-1', ProjectID: 'proj-1' },
            subTitles: STEPS.map((title) => ({ title })),
            sprintObj: { id: 'sprint-1', name: 'Sprint 1' }
        }));
        await runUndo();
        expect(ops.updateArchiveDelete).toHaveBeenCalledWith(expect.objectContaining({ deletedStatusKey: 1, task: expect.objectContaining({ _id: 'new-1' }) }));
    });

    it('hides an apply action the person may not take', async () => {
        perms.value = null;
        const wrapper = await openSteps();
        expect(wrapper.find('.aip__replace').exists()).toBe(false);
        expect(wrapper.find('.aip__insert').exists()).toBe(false);
        expect(wrapper.find('.aip__copy').exists()).toBe(true);
    });
});

describe('Research this', () => {
    it('previews the findings with their source links and posts a comment only on Add', async () => {
        api.replies[env.AI_TASK_ASSIST] = ok({ research: true });
        api.replies[env.AI_TASK_RESEARCH] = ok({ summary: 'Three tiers convert best [1].', sources: [{ n: 1, title: 'Pricing pages', url: 'https://example.org/pricing' }] });
        api.replies[env.API_COMMENTS] = ok({ _id: 'c1' });
        const wrapper = mountRow();
        await flushPromises();
        await wrapper.get('[data-action="research"]').trigger('click');
        await flushPromises();
        const link = wrapper.get('a[data-test="research-source"]');
        expect(link.attributes('href')).toBe('https://example.org/pricing');
        expect(link.attributes('rel')).toContain('noopener');
        expect(apiRequest).not.toHaveBeenCalledWith('post', env.API_COMMENTS, expect.anything());
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();
        const [, , body] = apiRequest.mock.calls.find(([method, url]) => method === 'post' && url === env.API_COMMENTS);
        expect(body.data.objId).toEqual({ projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' });
        expect(body.data.message).toContain('https://example.org/pricing');
    });
});
