import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, perms } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    perms: { allow: true }
}));

vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (d) => String(d) }),
    useCustomComposable: () => ({
        checkPermission: () => perms.allow,
        checkApps: () => true,
        getWasabiImageLink: async (cid, image) => image || '',
        makeUniqueId: () => 'id-1',
        debouncerWithPromise: () => Promise.resolve(),
        sanitizeInput: (text) => text
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }), getPriority: () => ({}) }),
    useMoment: () => ({ changeDateFormate: (d) => String(d) })
}));
vi.mock('@/composable/aiHelper', () => ({ useAiApiFunction: () => ({ generateAiRequestForFunction: vi.fn() }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/utils/trackerDeepLink', () => ({ openInTracker: vi.fn(() => ({ ok: true })), isTrackerCapableDevice: () => true }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '#/' }) }),
    useRoute: () => ({ params: { cid: 'c1', pageId: 'pg1' }, query: {}, name: 'PageEditor' })
}));
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
    ['@/components/atom/Skelaton/AiSkelaton.vue', 'AiSkelaton'],
    ['@/components/atom/Modal/Modal.vue', 'Modal'],
    ['@/components/molecules/Pages/PageDocument.vue', 'PageDocument']
]) vi.doMock(path, () => stub(name));

import { applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const WITH_AI = { _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Launch', ProjectCode: 'AH', isGlobalPermission: false, apps: [{ key: 'AI' }, { key: 'TimeEstimates' }] };
const WITHOUT_AI = { ...WITH_AI, apps: [{ key: 'TimeEstimates' }] };

const store = () => createStore({
    getters: {
        'settings/companyUserDetail': () => ({ roleType: 1 }),
        'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }),
        'settings/companyUsers': () => [],
        'settings/selectedCompany': () => ({}),
        'projectData/gettaskDetailData': () => null,
        'projectData/allProjects': () => ({ data: [{ _id: 'proj-1' }] })
    }
});

const CASES = [
    ['usable', { state: 'on', planAllowsAi: true, loaded: true }, WITH_AI, true, true],
    ['AI off for the workspace', { state: 'off_workspace', planAllowsAi: true, loaded: true }, WITH_AI, true, false],
    ['AI off for the instance', { state: 'off_instance', planAllowsAi: true, loaded: true }, WITH_AI, true, false],
    ['no provider', { state: 'unconfigured', planAllowsAi: true, loaded: true }, WITH_AI, true, false],
    ['state not known yet', { planAllowsAi: true }, WITH_AI, true, false],
    ['plan without AI', { state: 'on', planAllowsAi: false, loaded: true }, WITH_AI, true, false],
    ['project without the AI app', { state: 'on', planAllowsAi: true, loaded: true }, WITHOUT_AI, true, false],
    ['role not permitted', { state: 'on', planAllowsAi: true, loaded: true }, WITH_AI, false, false]
];

const mounted = [];
beforeEach(() => {
    resetAiAvailability();
    perms.allow = true;
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
});

describe('the AI estimate in the task panel', () => {
    async function mountSide(project) {
        const { default: TaskDetailRightSide } = await import('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue');
        const wrapper = mount(TaskDetailRightSide, {
            props: { task: { _id: 'task-1', TaskName: 'Write spec', ProjectID: 'proj-1', statusKey: 'st-open', AssigneeUserId: [], dueDateDeadLine: [] }, clientWidth: 1280 },
            global: { plugins: [store()], provide: { $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'), selectedProject: ref(project) } }
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    }

    it.each(CASES)('%s', async (_name, availability, project, allow, shown) => {
        applyAiAvailability(availability);
        perms.allow = allow;
        const wrapper = await mountSide(project);
        expect(wrapper.find('.ai-estimate-btn').exists()).toBe(shown);
    });
});

describe('Suggest checklists', () => {
    async function mountChecklist(project) {
        const { default: CheckList } = await import('@/components/molecules/CheckList/CheckList.vue');
        const wrapper = shallowMount(CheckList, {
            props: { taskId: 'task-1', permission: true },
            global: { plugins: [store()], provide: { selectedProject: ref(project), $userId: ref('u1') } }
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    }

    it.each(CASES)('%s', async (_name, availability, project, allow, shown) => {
        applyAiAvailability(availability);
        perms.allow = allow;
        const wrapper = await mountChecklist(project);
        expect(wrapper.text().includes('Checklist.suggest_checklists')).toBe(shown);
    });
});

describe('Ask about this doc', () => {
    async function mountEditor() {
        const { default: PageEditorView } = await import('@/views/Pages/PageEditorView.vue');
        const wrapper = shallowMount(PageEditorView, { global: { plugins: [store()] } });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    }

    it.each(CASES.filter(([, , project, allow]) => project === WITH_AI && allow))('%s', async (_name, availability, _project, _allow, shown) => {
        applyAiAvailability(availability);
        const wrapper = await mountEditor();
        expect(wrapper.text().includes('Docs.ask_about_doc')).toBe(shown);
    });
});
