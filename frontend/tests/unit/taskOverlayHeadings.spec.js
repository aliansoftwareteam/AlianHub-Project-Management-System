import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, slotStub } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    slotStub: (name, slot) => ({
        default: {
            name,
            setup(_, { slots }) {
                return () => (slots[slot] ? slots[slot]() : null);
            }
        }
    })
}));

const project = {
    _id: 'proj-1',
    isGlobalPermission: false,
    taskStatusData: [{ key: 'st-open', name: 'Open', type: 'open', value: 'open', bgColor: '#eee', textColor: '#000' }],
    taskTypeCounts: [],
    sprintsObj: [],
    sprintsfolders: [],
    tasks: [{ _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: ['u1'], Task_Leader: 'u1', Task_Priority: 'LOW' }],
    subtasks: []
};

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => (String(url).includes('/taskData')
        ? Promise.resolve({ status: 200, data: [JSON.parse(JSON.stringify(project))] })
        : Promise.resolve({ status: 200, data: { status: false, data: [] } })))
}));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (d) => String(d) }),
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: () => true,
        getWasabiImageLink: async (cid, image) => image || '',
        makeUniqueId: () => 'id-1',
        debouncerWithPromise: () => Promise.resolve()
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }), getPriority: () => ({}) }),
    useMoment: () => ({ changeDateFormate: (d) => String(d) })
}));
vi.mock('@/composable/aiHelper', () => ({ useAiApiFunction: () => ({ generateAiRequestForFunction: vi.fn() }) }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '#/' }) }),
    useRoute: () => ({ params: {}, query: {}, name: 'ProjectSprint' })
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), setTaskMeta: vi.fn() }));
for (const [path, name] of [
    ['@/components/organisms/Shell/ShellIcon.vue', 'ShellIcon'],
    ['@/components/atom/Skelaton/Skelaton.vue', 'Skelaton'],
    ['@/components/atom/TaskTypeSelection/TaskTypeSelection.vue', 'TaskTypeSelection'],
    ['@/components/atom/InputText/InputText.vue', 'InputText'],
    ['@/components/molecules/EstimateHours/EstimateHours.vue', 'EstimateHours'],
    ['@/components/molecules/EstimatedTimeInput/EstimatedTimeInput.vue', 'EstimatedTimeInput'],
    ['@/components/molecules/TaskStatus/TaskStatus.vue', 'TaskStatus'],
    ['@/components/molecules/Assignee/Assignee.vue', 'Assignee'],
    ['@/components/atom/UserProfile/UserProfile.vue', 'UserProfile'],
    ['@/components/molecules/PriorityCompo/PriorityComp.vue', 'PriorityComp'],
    ['@/components/atom/StoryPoints/StoryPoints.vue', 'StoryPoints'],
    ['@/components/molecules/DueDateCompo/DueDateCompo.vue', 'DueDateCompo'],
    ['@/components/atom/Modal/Modal.vue', 'Modal'],
    ['@/components/molecules/TaskDetailAction/TaskDetailAction.vue', 'TaskDetailAction'],
    ['@/views/Projects/Comments/Comments.vue', 'Comments'],
    ['@/components/templates/ActivityLog/ActivityLog.vue', 'ActivityLog'],
    ['@/components/molecules/Pages/PagesPanel.vue', 'PagesPanel'],
    ['@/components/atom/TagChip/TagChip.vue', 'TagChip'],
    ['@/components/molecules/TagList/CreateTagPopup.vue', 'CreateTagPopup'],
    ['@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue', 'TaskSummaryBlock'],
    ['@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', 'TaskTimerChip'],
    ['@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue', 'TaskAgentStrip']
]) vi.doMock(path, () => stub(name));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => slotStub('TaskDetailTab', 'after-description'));
vi.mock('@/components/organisms/LinkedTasks/LinkedTasks.vue', () => slotStub('LinkedTasks', 'none'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSubtaskList.vue', () => slotStub('TaskSubtaskList', 'none'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTrackerHandoff.vue', () => slotStub('TaskTrackerHandoff', 'none'));

import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const store = () => createStore({
    getters: {
        'settings/companyUserDetail': () => ({ roleType: 1 }),
        'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }),
        'projectData/gettaskDetailData': () => null,
        'settings/companyUsers': () => [],
        'settings/projectRules': () => ({ 'task.task_status': true }),
        'settings/selectedCompany': () => ({}),
        'settings/finalCustomFields': () => []
    },
    actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
    mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {} }
});

const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const levelOf = (el) => Number(el.getAttribute('aria-level') || el.tagName.slice(1));
const outline = (root) => [...root.querySelectorAll(HEADING)].map(levelOf);

const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

async function mountPanel() {
    document.body.innerHTML = '<h1>Launch</h1><div id="overlay"></div>';
    const { default: TaskDetailPanel } = await import('@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue');
    const wrapper = mount(TaskDetailPanel, {
        attachTo: '#overlay',
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
        global: { plugins: [store()], mocks: { $t: t }, provide: { $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY') } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe('task overlay heading order (A11Y-O2)', () => {
    it('runs from the page h1 to the task title as h2 and the Details section as h3, with no h4', async () => {
        await mountPanel();
        expect(outline(document.body)).toEqual([1, 2, 3]);
        expect(document.querySelector('h2').textContent.trim()).toBe('Write spec');
        expect(document.querySelector('h3').textContent.trim()).toBe(t('ProjectDetails.details'));
    });

    it('keeps each field label as text beside its value rather than a heading', async () => {
        const wrapper = await mountPanel();
        const labels = wrapper.findAll('.task-detail-right-side-label').map((row) => row.element.firstElementChild);
        expect(labels.map((el) => el.textContent.trim())).toEqual(expect.arrayContaining([
            t('ProjectDetails.status'),
            t('ProjectDetails.assignee'),
            t('Projects.priority'),
            t('TaskPanel.story_points'),
            t('Milestone.start_date'),
            t('Projects.due_date'),
            t('UserTimesheet.estimated')
        ]));
        for (const label of labels) expect(label.matches(HEADING)).toBe(false);
    });
});

describe('section headings inside the task overlay (A11Y-O2)', () => {
    const provide = { selectedProject: ref(project), $userId: ref('u1') };

    it('Checklist is an h3 and its "suggest" action is not a heading', async () => {
        const { default: CheckList } = await import('@/components/molecules/CheckList/CheckList.vue');
        const wrapper = shallowMount(CheckList, { props: { taskId: 'task-1', permission: true }, global: { plugins: [store()], mocks: { $t: t }, provide } });
        mounted.push(wrapper);
        const headings = wrapper.findAll(HEADING);
        expect(headings.map((h) => levelOf(h.element))).toEqual([3]);
        expect(headings[0].text()).toBe(t('Checklist.checklist'));
        expect(wrapper.text()).toContain(t('Checklist.suggest_checklists'));
    });

    it('Custom fields is an h3 and its "+ Custom field" action is not a heading', async () => {
        const { default: CustomFieldRender } = await import('@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue');
        const wrapper = shallowMount(CustomFieldRender, { props: { task: { _id: 'task-1' }, editPermission: true }, global: { plugins: [store()], mocks: { $t: t }, provide } });
        mounted.push(wrapper);
        const headings = wrapper.findAll(HEADING);
        expect(headings.map((h) => levelOf(h.element))).toEqual([3]);
        expect(headings[0].text()).toBe(t('CustomField.custom_field'));
        expect(wrapper.text()).toContain(`+ ${t('CustomField.custom_field')}`);
    });

    it('Attachments is an h3', async () => {
        const { default: Attachments } = await import('@/components/atom/Attachments/Attachments.vue');
        const wrapper = shallowMount(Attachments, { props: { attachments: [], extensions: [], permission: true }, global: { mocks: { $t: t }, provide } });
        mounted.push(wrapper);
        const headings = wrapper.findAll(HEADING);
        expect(headings.map((h) => levelOf(h.element))).toEqual([3]);
        expect(headings[0].text()).toContain(t('Attachments.attachments'));
    });
});
