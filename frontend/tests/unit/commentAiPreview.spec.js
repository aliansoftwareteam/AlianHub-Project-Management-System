import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, slotStub, exposed, toast, projectPayload, ai } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    slotStub: (name, slot, methods = []) => ({
        default: {
            name,
            setup(_, { slots, expose }) {
                expose(Object.fromEntries(methods.map((method) => [method, (...args) => exposed[`${name}.${method}`](...args)])));
                return () => (slots[slot] ? slots[slot]() : null);
            }
        }
    }),
    exposed: {},
    toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
    projectPayload: {
        _id: 'proj-1',
        isGlobalPermission: false,
        taskStatusData: [{ key: 'st-open', name: 'Open', type: 'open', value: 'open', bgColor: '#eee', textColor: '#000' }],
        taskTypeCounts: [],
        sprintsObj: [],
        sprintsfolders: [],
        tasks: [{ _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [] }],
        subtasks: []
    },
    ai: { replies: [] }
}));

vi.mock('@/config/publicConfig', () => ({ publicConfig: { agentSessions: false } }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [JSON.parse(JSON.stringify(projectPayload))] });
        if (String(url).includes('/ai/description')) return Promise.resolve({ data: { status: true, data: { description: ai.replies.shift() || 'Generated' } } });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateStatus: vi.fn() } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'id' }),
    useGetterFunctions: () => ({ getUser: () => ({}), getPriority: () => ({}) })
}));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '#/' }) }),
    useRoute: () => ({ params: {}, query: {}, name: 'ProjectSprint' })
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), setTaskMeta: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/atom/Skelaton/Skelaton.vue', () => stub('Skelaton'));
vi.mock('@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue', () => stub('TaskDetailTitle'));
vi.mock('@/components/molecules/TaskDetailAction/TaskDetailAction.vue', () => stub('TaskDetailAction'));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => slotStub('TaskDetailTab', 'after-description', ['addChecklist', 'attachFile']));
vi.mock('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue', () => slotStub('TaskDetailRightSide', 'status'));
vi.mock('@/components/organisms/LinkedTasks/LinkedTasks.vue', () => slotStub('LinkedTasks', 'none', ['startAdding']));
vi.mock('@/views/Projects/Comments/Comments.vue', async () => {
    const { h } = await import('vue');
    return {
        default: {
            name: 'Comments',
            render: () => h('div', { class: 'position-re' }, [
                h('div', { class: 'msg__container' }),
                h('div', { id: 'comment_footer', class: 'comment__footer' }, [h('textarea', { id: 'message-box' })])
            ])
        }
    };
});
vi.mock('@/components/templates/ActivityLog/ActivityLog.vue', () => stub('ActivityLog'));
vi.mock('@/components/molecules/Pages/PagesPanel.vue', () => stub('PagesPanel'));
vi.mock('@/components/molecules/TagList/CreateTagPopup.vue', () => stub('CreateTagPopup'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue', () => stub('TaskSummaryBlock'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSubtaskList.vue', () => slotStub('TaskSubtaskList', 'none', ['startCreate']));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => stub('TaskTimerChip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue', () => stub('TaskAgentStrip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTrackerHandoff.vue', () => slotStub('TaskTrackerHandoff', 'none', ['start']));

import { apiRequest } from '@/services';
import TaskDetailPanel from '@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue';
import en from '@/locales/en.js';
import { applyAiAvailability } from '@/composable/aiAvailability';

applyAiAvailability({ state: 'on', planAllowsAi: true, loaded: true });

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

async function mountPanel() {
    const store = createStore({
        getters: {
            'settings/companyUserDetail': () => ({ roleType: 1 }),
            'settings/companyOwnerDetail': () => ({}),
            'projectData/gettaskDetailData': () => null,
            'settings/companyUsers': () => [],
            'settings/projectRules': () => ({ 'task.task_comment': true }),
            'settings/selectedCompany': () => ({})
        },
        actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
        mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {} }
    });
    const wrapper = mount(TaskDetailPanel, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
        global: { plugins: [store], mocks: { $t: i18n.global.t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280) } }
    });
    await flushPromises();
    return wrapper;
}

async function runAi(wrapper, value, caret = value.length) {
    const box = wrapper.get('#message-box');
    box.element.value = value;
    box.element.setSelectionRange(caret, caret);
    box.element.focus();
    await box.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    return box;
}

const preview = () => document.querySelector('.aip');
const click = async (selector) => {
    preview().querySelector(selector).click();
    await flushPromises();
};

beforeEach(() => {
    apiRequest.mockClear();
    ai.replies = [];
});
afterEach(() => { document.body.innerHTML = ''; });

describe('/ai in a task comment', () => {
    it('shows the generated text above the composer and keeps the draft untouched', async () => {
        ai.replies = ['Status: the spec is in review.'];
        const wrapper = await mountPanel();
        const box = await runAi(wrapper, '/ai summarise the status');
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/ai/description'))).toBe(true);
        expect(box.element.value).toBe('/ai summarise the status');
        expect(preview()).not.toBeNull();
        expect(preview().textContent).toContain('Status: the spec is in review.');
        expect(document.querySelector('#comment_footer').contains(preview())).toBe(true);
    });

    it('keeps the draft on Cancel', async () => {
        const wrapper = await mountPanel();
        const box = await runAi(wrapper, 'Hi team,\n/ai ask for a review');
        await click('.aip__cancel');
        expect(preview()).toBeNull();
        expect(box.element.value).toBe('Hi team,\n/ai ask for a review');
        expect(document.activeElement).toBe(box.element);
    });

    it('puts the text where the /ai line was on Insert and keeps the rest of the draft', async () => {
        ai.replies = ['Could you review the spec?'];
        const wrapper = await mountPanel();
        const box = await runAi(wrapper, 'Hi team,\n/ai ask for a review\nThanks');
        await click('.aip__insert');
        expect(box.element.value).toBe('Hi team,\nCould you review the spec?\nThanks');
        expect(preview()).toBeNull();
    });

    it('replaces the whole draft on Replace', async () => {
        ai.replies = ['Could you review the spec?'];
        const wrapper = await mountPanel();
        const box = await runAi(wrapper, 'Hi team,\n/ai ask for a review');
        await click('.aip__replace');
        expect(box.element.value).toBe('Could you review the spec?');
    });

    it('asks again on Try again without touching the draft', async () => {
        ai.replies = ['First try', 'Second try'];
        const wrapper = await mountPanel();
        const box = await runAi(wrapper, '/ai ask for a review');
        await click('.aip__retry');
        expect(apiRequest.mock.calls.filter(([, url]) => String(url).includes('/ai/description'))).toHaveLength(2);
        expect(preview().textContent).toContain('Second try');
        expect(box.element.value).toBe('/ai ask for a review');
    });

    it('leaves Enter alone when the caret line is not an /ai command', async () => {
        const wrapper = await mountPanel();
        await runAi(wrapper, 'Just a normal comment');
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/ai/description'))).toBe(false);
        expect(preview()).toBeNull();
    });
});
