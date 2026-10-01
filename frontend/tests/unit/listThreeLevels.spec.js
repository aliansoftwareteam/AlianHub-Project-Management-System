/* Three levels of subtasks in the real List: the real ListView, ListGroup and ListRow, the real
   loader and store, and an unmocked `@/composable`. Only the HTTP layer is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { server } = vi.hoisted(() => ({ server: { tasks: [], calls: [] } }));

vi.mock('@/services', () => {
    const matches = (task, condition = {}) => Object.entries(condition).every(([field, want]) => {
        if (field === 'objId') return Object.entries(want).every(([key, value]) => task[key] === value);
        if (want && typeof want === 'object' && '$eq' in want) return task[field] === want.$eq;
        if (want && typeof want === 'object' && '$in' in want) return want.$in.includes(task[field]);
        return task[field] === want;
    });
    const answer = (stages) => {
        const match = stages.find((stage) => stage.$match)?.$match || {};
        const rows = server.tasks.filter((task) => matches(task, match)).sort((a, b) => (a.groupByStatusIndex - b.groupByStatusIndex) || (a._id > b._id ? 1 : -1));
        const facet = stages.find((stage) => stage.$facet)?.$facet;
        if (facet?.result) {
            const skip = facet.result.find((stage) => '$skip' in stage)?.$skip || 0;
            return [{ result: rows.slice(skip, skip + 35).map((task) => ({ ...task })), count: rows.length ? [{ count: rows.length }] : [] }];
        }
        if (stages.some((stage) => stage.$group)) {
            const byParent = new Map();
            rows.forEach((task) => {
                const entry = byParent.get(task.ParentTaskId) || { _id: task.ParentTaskId, total: 0, completed: 0 };
                entry.total += 1;
                if (task.statusType === 'close') entry.completed += 1;
                byParent.set(task.ParentTaskId, entry);
            });
            return [...byParent.values()];
        }
        return [];
    };
    return {
        apiRequest: vi.fn((method, url, body) => {
            const stages = body?.findQuery || [];
            if (stages.length) server.calls.push(stages);
            return Promise.resolve({ status: 200, data: answer(stages) });
        })
    };
});
vi.mock('vue-router', async () => {
    const { reactive } = await import('vue');
    const route = reactive({ query: { tab: 'ProjectListView' }, params: {} });
    return { useRoute: () => route, useRouter: () => ({ resolve: () => ({ href: '/task' }), hasRoute: () => false, push: vi.fn() }) };
});
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), useTaskSequenceSource: () => {} }));

import Store from '@/store/index';
import ListView from '@/views/Projects/ListView/ListView.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const PEOPLE = ['u1', 'u2', 'u3'];
const TODO = { key: 1, name: 'To Do', type: 'default_active', value: 'todo', textColor: '#777', bgColor: '#eee' };
const DONE = { key: 2, name: 'Done', type: 'close', value: 'done', textColor: '#2a2', bgColor: '#e2f7e2' };
const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'QA Sandbox', ProjectCode: 'QA', isGlobalPermission: true, isPrivateSpace: false,
    lastTaskId: 9, AssigneeUserId: PEOPLE, taskStatusData: [TODO, DONE], apps: [{ key: 'tags' }],
    sprintsObj: { [SPRINT]: { id: SPRINT, name: 'List', private: false } }
};

const row = (id, name, over = {}) => ({
    _id: id, TaskName: name, TaskKey: `QA-${id}`, ProjectID: PID, sprintId: SPRINT, sprintArray: { id: SPRINT, name: 'List' },
    isParentTask: true, ParentTaskId: '', ancestors: [], statusKey: 1, statusType: 'default_active', groupByStatusIndex: 1,
    AssigneeUserId: [], tagsArray: [], deletedStatusKey: 0, subTasks: 0, ...over
});
const under = (parentRow, id, name, over = {}) => row(id, name, {
    isParentTask: false, ParentTaskId: parentRow._id, ancestors: [...parentRow.ancestors, parentRow._id], ...over
});

const seedServer = () => {
    const parent = row('t1', 'Parent', { subTasks: 2 });
    const first = under(parent, 's1', 'Child one', { subTasks: 2, AssigneeUserId: ['u2'] });
    const second = under(parent, 's2', 'Child two', { groupByStatusIndex: 2 });
    server.tasks = [
        parent, first, second,
        under(first, 'g1', 'Grandchild one'),
        under(first, 'g2', 'Grandchild two', { groupByStatusIndex: 2, statusKey: 2, statusType: 'close' }),
        row('t2', 'Loner', { groupByStatusIndex: 2 })
    ];
    server.calls = [];
};

function seedStore() {
    Store.state.settings.companies = [{ _id: 'c1', planFeature: { listView: true, tagProjectApp: true } }];
    Store.state.settings.selectedCompanyId = 'c1';
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType: 1 };
    Store.state.settings.rules = { task: {} };
    Store.state.settings.companyUsers = PEOPLE.map((userId) => ({ _id: `cu-${userId}`, userId, isDelete: false }));
    Store.state.settings.socketInstance = { id: 'sock', emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    Store.state.users.users = PEOPLE.map((id) => ({ _id: id, Employee_Name: `Person ${id}` }));
    Store.state.projectData.tasks = {};
    Store.state.projectData.searchedTasks = [];
    Store.state.projectData.getPaginatedTaskPayload = [];
    Store.state.taskSelection.selectedTaskIds = [];
}

const PICKER = 'Assignee';
const AssigneeStub = defineComponent({
    name: PICKER,
    props: { users: Array, options: Array },
    setup: (props, { slots }) => () => h('div', { class: 'assignee-stub' }, slots.trigger ? slots.trigger({ open: () => {} }) : [])
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});

const settle = async (ms = 0) => {
    await flushPromises();
    if (ms) vi.advanceTimersByTime(ms);
    await flushPromises();
};

let wrapper;

async function openList() {
    wrapper = mount(ListView, {
        attachTo: document.body,
        props: { grouped: 0, sprints: [{ id: SPRINT, name: 'List', projectId: PID, tasks: 6, deletedStatusKey: 0 }], sprintLoading: false },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: {
                selectedProject: ref(PROJECT), $clientWidth: ref(1280), $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'),
                showArchived: ref(false), searchedTask: ref(false), taskCollapsed: ref(true), clearTaskFilters: () => {},
                $defaultUserAvatar: ref(''), $defaultGhostCustomUserImg: ref(''), $defaultTaskStatusImg: ref('')
            },
            stubs: {
                draggable: DraggableStub, Assignee: AssigneeStub, UpgradePlan: true, SprintListing: true, Skelaton: true, ListBulkBar: true,
                CreateTask: true, EmptyState: true, ViewColumnChooser: true, ViewDensityControl: true, AiFieldColumnHead: true, ListSortControl: true,
                ConvertToSubTaskSidebar: true, TaskMenuSidebars: true, ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true,
                ListStatusCircle: true, ListDueCell: true, ListPriorityCell: true, EstimateCell: true, TaskColumnCell: true
            }
        }
    });
    await settle();
    return wrapper;
}

const rows = () => wrapper.findAll('.lv2__row');
const names = () => rows().map((el) => el.find('.lv2__name').text());
const rowOf = (name) => rows().find((el) => el.find('.lv2__name').text() === name);
const depthOf = (name) => rowOf(name).find('.lv2__title').element.style.getPropertyValue('--lv2-depth');
const disclosure = (name) => rowOf(name).find('button.lv2__disclose');
const open = async (name) => {
    await disclosure(name).trigger('click');
    await settle();
};
const childReads = (parentId) => server.calls.filter((stages) => stages[0].$match.ParentTaskId === parentId);
const fromSocket = (op, data, updatedFields = {}) => Store.commit('projectData/mutateUpdateFirebaseTasks', {
    snap: {}, op, pid: PID, sprintId: SPRINT, data: { ...data }, updatedFields
});
const stored = (id) => server.tasks.find((task) => task._id === id);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seedServer();
    seedStore();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('each level opens from its own row', () => {
    beforeEach(async () => { await openList(); });

    it('starts with the tasks only, and a disclosure on the one that has subtasks', () => {
        expect(names()).toEqual(['Parent', 'Loner']);
        expect(disclosure('Parent').exists()).toBe(true);
        expect(disclosure('Loner').exists()).toBe(false);
    });

    it('opening a task reads its subtasks by parent and shows them one step in', async () => {
        await open('Parent');
        expect(names()).toEqual(['Parent', 'Child one', 'Child two', 'Loner']);
        expect(childReads('t1')).toHaveLength(1);
        expect(depthOf('Child one')).toBe('1');
        expect(disclosure('Child one').exists()).toBe(true);
        expect(disclosure('Child two').exists()).toBe(false);
    });

    it('opening a subtask reads its own subtasks and shows them two steps in, with no disclosure', async () => {
        await open('Parent');
        await open('Child one');
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one', 'Grandchild two', 'Child two', 'Loner']);
        expect(childReads('s1')).toHaveLength(1);
        expect(depthOf('Grandchild one')).toBe('2');
        expect(disclosure('Grandchild one').exists()).toBe(false);
        expect(Store.state.projectData.tasks[PID][SPRINT].tasks.map((task) => task._id)).toEqual(['t1', 't2']);
    });

    it('reads each level once: closing and reopening asks for nothing', async () => {
        await open('Parent');
        await open('Child one');
        await open('Child one');
        expect(names()).not.toContain('Grandchild one');
        await open('Child one');
        await open('Parent');
        await open('Parent');
        expect(names()).toContain('Grandchild one');
        expect(childReads('t1')).toHaveLength(1);
        expect(childReads('s1')).toHaveLength(1);
    });

    it('counts direct children on each row: 0/2 on the task, 1/2 on its subtask', async () => {
        await open('Parent');
        await settle();
        expect(rowOf('Parent').find('.lv2__key').text()).toContain('0/2');
        expect(rowOf('Child one').find('.lv2__key').text()).toContain('1/2');
    });
});

describe('a row acts the same on every level', () => {
    beforeEach(async () => {
        await openList();
        await open('Parent');
        await open('Child one');
    });

    const actions = (name) => rowOf(name).findAll('.lv2__actions [data-action]').map((button) => button.attributes('data-action'));

    it('offers Add subtask on a task and on a subtask, and not on a sub-subtask', () => {
        expect(actions('Parent')).toContain('subtask');
        expect(actions('Child one')).toContain('subtask');
        expect(actions('Grandchild one')).not.toContain('subtask');
    });

    it('opens the create row under the subtask it was asked from', async () => {
        await rowOf('Child two').find('[data-action="subtask"]').trigger('click');
        await settle();
        const create = wrapper.findComponent({ name: 'CreateTask' });
        expect(create.exists()).toBe(true);
        expect(create.attributes('taskid')).toBe('s2');
    });

    it('offers a sub-subtask the people of the subtask above it', () => {
        const picker = (name) => [...rowOf(name).findComponent(AssigneeStub).props('options')].sort();
        expect(picker('Grandchild one')).toEqual(['u2']);
        expect(picker('Child two')).toEqual(PEOPLE);
    });

    it('keeps every open level open when a sub-subtask changes', async () => {
        fromSocket('modified', { ...stored('g1'), statusKey: 2, statusType: 'close' }, { statusKey: 2, statusType: 'close' });
        await settle();
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one', 'Grandchild two', 'Child two', 'Loner']);
    });

    it('shows a sub-subtask someone else adds, under its subtask', async () => {
        const added = under(stored('s1'), 'g3', 'Grandchild three', { groupByStatusIndex: 3 });
        fromSocket('added', added, added);
        await settle();
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one', 'Grandchild two', 'Grandchild three', 'Child two', 'Loner']);
    });

    it('moves a sub-subtask to the top of its group when it is made a task', async () => {
        const promoted = { ...stored('g1'), isParentTask: true, ParentTaskId: '', ancestors: [], groupByStatusIndex: 9 };
        fromSocket('modified', promoted, { isParentTask: true, ParentTaskId: '', ancestors: [] });
        await settle();
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild two', 'Child two', 'Loner', 'Grandchild one']);
        expect(depthOf('Grandchild one')).toBe('');
    });

    it('takes the rows under a subtask away with it when it is removed', async () => {
        fromSocket('removed', stored('s1'));
        await settle();
        expect(names()).toEqual(['Parent', 'Child two', 'Loner']);
    });
});

describe('the name takes the room of an empty Tags column', () => {
    const tracks = () => wrapper.find('.lv2').element.style.getPropertyValue('--lv2-cols');

    it('keeps Tags narrow while no row shown has a tag', async () => {
        await openList();
        expect(tracks()).toContain('minmax(0, 1fr) 56px');
    });

    it('gives Tags its share again once a row has one, on any level', async () => {
        stored('g1').tagsArray = ['tag1'];
        await openList();
        expect(tracks()).toContain('minmax(0, 1fr) 56px');
        await open('Parent');
        await open('Child one');
        expect(tracks()).toContain('minmax(0, 1fr) minmax(0, .45fr)');
    });
});
