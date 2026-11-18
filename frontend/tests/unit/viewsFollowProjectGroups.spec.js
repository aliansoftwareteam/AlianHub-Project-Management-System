/* A project that gains a status while one of its task views is open: the List, the Board and the Table each draw
   the new group and read its tasks, without a reload. The real views, the real loader (taskListHelper) and the
   real store run here; only the HTTP layer is a stand-in, which answers the task queries as the server would. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { server } = vi.hoisted(() => ({ server: { tasks: [], calls: [] } }));

vi.mock('@/services', () => {
    const holds = (have, want) => {
        if (want && typeof want === 'object' && !Array.isArray(want)) {
            if ('objId' in want) return holds(have, want.objId);
            if ('$eq' in want) return have === want.$eq;
            if ('$in' in want) return want.$in.includes(have);
        }
        return have === want;
    };
    const matches = (task, condition = {}) => Object.entries(condition).every(([field, want]) => {
        if (field === '$and') return want.every((part) => matches(task, part));
        if (field === 'objId') return Object.entries(want).every(([key, value]) => task[key] === value);
        return holds(task[field], want);
    });
    const answer = (stages) => {
        const rows = server.tasks.filter((task) => matches(task, stages.find((stage) => stage.$match)?.$match || {}));
        const facet = stages.find((stage) => stage.$facet)?.$facet;
        if (!facet) {
            const skip = stages.find((stage) => '$skip' in stage)?.$skip || 0;
            return rows.slice(skip).map((task) => ({ ...task }));
        }
        if (facet.result) {
            const skip = facet.result.find((stage) => '$skip' in stage)?.$skip || 0;
            return [{ result: rows.slice(skip).map((task) => ({ ...task })), count: rows.length ? [{ count: rows.length }] : [] }];
        }
        return [Object.fromEntries(Object.entries(facet).map(([name, pipeline]) => {
            const count = rows.filter((task) => matches(task, pipeline[0].$match)).length;
            return [name, count ? [{ count }] : []];
        }))];
    };
    return {
        apiRequest: vi.fn((method, url, body) => {
            if (String(url).endsWith('/tasks/everything')) return Promise.resolve({ data: { status: true, data: { rows: [], projects: {}, nextCursor: null } } });
            const stages = body?.findQuery || [];
            server.calls.push(stages);
            return Promise.resolve({ status: 200, data: answer(stages) });
        })
    };
});
vi.mock('vue-router', async () => {
    const { reactive: makeReactive } = await import('vue');
    const route = makeReactive({ query: { tab: 'ProjectListView' }, params: {} });
    return { useRoute: () => route, useRouter: () => ({ resolve: () => ({ href: '/task' }), hasRoute: () => false, push: vi.fn() }) };
});
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/Kanban/useProjectAgents', () => ({ useProjectAgents: () => ({ start: () => {}, stop: () => {}, summary: { value: null } }) }));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), useTaskSequenceSource: () => {} }));
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: vi.fn(), FIRST_RUN_STEPS: { BOARD_VIEW: 'board' } }));

import Store from '@/store/index';
import ListView from '@/views/Projects/ListView/ListView.vue';
import BoardView from '@/views/Projects/Kanban/BoardView.vue';
import TableView from '@/views/Projects/TableView/TableView.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const TODO = { key: 1, name: 'To Do', type: 'default_active', value: 'todo', textColor: '#777', bgColor: '#eee' };
const DONE = { key: 2, name: 'Done', type: 'close', value: 'done', textColor: '#2a2', bgColor: '#e2f7e2' };
const REVIEW = { key: 3, name: 'Review', type: 'active', value: 'review', textColor: '#a62', bgColor: '#f7ece2' };
const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'Kickoff', ProjectCode: 'KO', isGlobalPermission: true, isPrivateSpace: false,
    lastTaskId: 3, AssigneeUserId: ['u1'], taskStatusData: [TODO, DONE], apps: [], sprintsObj: { [SPRINT]: { id: SPRINT, name: 'Backlog' } }
};
const sprints = () => [{ id: SPRINT, name: 'Backlog', projectId: PID, tasks: 2, deletedStatusKey: 0 }];
const task = (n, statusKey, name) => ({
    _id: `t${n}`, TaskName: name, TaskKey: `KO-${n}`, ProjectID: PID, sprintId: SPRINT, isParentTask: true,
    statusKey, groupByStatusIndex: n, createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString(),
    AssigneeUserId: [], deletedStatusKey: 0, subTasks: 0
});
const BRIEF = task(3, REVIEW.key, 'Write the brief');

function seedStore() {
    Store.state.settings.companies = [{ _id: 'c1', planFeature: { listView: true, boardView: true, tableView: true } }];
    Store.state.settings.selectedCompanyId = 'c1';
    Store.state.settings.companyPriority = [{ name: 'High', value: 'HIGH', statusImage: '' }];
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType: 1 };
    Store.state.settings.rules = { task: {} };
    Store.state.settings.companyUsers = [{ _id: 'cu-u1', userId: 'u1', isDelete: false }];
    Store.state.settings.socketInstance = { id: 'sock', emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    Store.state.users.users = [{ _id: 'u1', Employee_Name: 'Olivia Owner' }];
    Store.state.projectData.tasks = {};
    Store.state.projectData.tableTasks = {};
    Store.state.projectData.tableGroupCounts = {};
    Store.state.projectData.allProjects = [];
    Store.state.projectData.otherProjectChanges = 0;
    Store.state.projectData.searchedTasks = [];
    Store.state.projectData.getPaginatedTaskPayload = [];
    Store.state.taskSelection.selectedTaskIds = [];
}

let observers = [];
class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
}
const bringEveryGroupIntoView = () => observers.forEach((observer) => {
    if (observer.targets.size) observer.callback([...observer.targets].map((target) => ({ isIntersecting: true, target })));
});

const ListRowStub = defineComponent({
    name: 'ListRow',
    props: { data: Object, isSub: Boolean },
    setup: (props) => () => h('div', { class: 'row' }, props.data.TaskName)
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});
const BoardStub = defineComponent({
    name: 'KanbanBoard',
    props: { data: { type: Array, default: () => [] } },
    setup: (props) => () => h('div', props.data.map((column) => h('section', { class: 'column', 'data-name': column.name },
        column.tasksArray.map((card) => h('div', { class: 'card' }, card.TaskName)))))
});
const TableRowStub = defineComponent({
    name: 'TableRow',
    props: { data: Object },
    setup: (props) => () => h('div', { class: 'table-row' }, props.data.TaskName)
});

const settle = async (ms = 0) => {
    await flushPromises();
    if (ms) vi.advanceTimersByTime(ms);
    await flushPromises();
};

let wrapper;
let project;

async function open(view, props = {}) {
    project = ref(PROJECT);
    wrapper = mount(view, {
        attachTo: document.body,
        props: { grouped: 0, sprints: sprints(), ...props },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: {
                selectedProject: project, $clientWidth: ref(1280), $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'),
                showArchived: ref(false), searchedTask: ref(false), taskCollapsed: ref(true), clearTaskFilters: () => {},
                $defaultUserAvatar: ref(''), $defaultGhostCustomUserImg: ref(''), $defaultTaskStatusImg: ref('')
            },
            stubs: {
                ListRow: ListRowStub, draggable: DraggableStub, KanbanBoard: BoardStub, TableRow: TableRowStub, TableSubtaskRows: true,
                ListSortControl: true, UpgradePlan: true, SprintListing: true, Skelaton: true, ListBulkBar: true, CreateTask: true, EmptyState: true,
                ViewColumnChooser: true, ViewDensityControl: true, AiFieldColumnHead: true, AiColumnHead: true, ConvertToSubTaskSidebar: true,
                TaskMenuSidebars: true, ListMenu: true, OtherProjectRows: true
            }
        }
    });
    await settle(600);
    bringEveryGroupIntoView();
    await settle(600);
    return wrapper;
}

/* What `replaceProject` leaves in the store after `projectChanged`: the same project, read again. */
async function projectGainsReview() {
    server.tasks.push(BRIEF);
    project.value = { ...PROJECT, taskStatusData: [TODO, REVIEW, DONE] };
    await settle(600);
    bringEveryGroupIntoView();
    await settle(600);
    await settle(600);
}

const listGroups = () => Object.fromEntries(wrapper.findAll('.lv2__group').map((el) => [el.find('.lv2__group-name').text(), el.findAll('.row').map((row) => row.text())]));
const boardColumns = () => Object.fromEntries(wrapper.findAll('.column').map((el) => [el.attributes('data-name'), el.findAll('.card').map((card) => card.text())]));
const tableGroups = () => Object.fromEntries(wrapper.findAll('[role="rowgroup"]').map((el) => [el.find('.ah-chip').text(), el.findAll('.table-row').map((row) => row.text())]));

beforeEach(() => {
    /* setImmediate stays real: flushPromises waits on it. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    observers = [];
    window.IntersectionObserver = FakeIntersectionObserver;
    server.tasks = [task(1, TODO.key, 'Collect the logins'), task(2, DONE.key, 'Sign the contract')];
    server.calls = [];
    seedStore();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('a project gains a status while a view of it is open', () => {
    it('the List draws the new group with the task that is in it', async () => {
        await open(ListView, { sprintLoading: false });
        expect(listGroups()).toEqual({ 'To Do': ['Collect the logins'], Done: ['Sign the contract'] });

        await projectGainsReview();

        expect(listGroups()).toEqual({ 'To Do': ['Collect the logins'], Review: ['Write the brief'], Done: ['Sign the contract'] });
    });

    it('the List reads only the new group: the groups it already holds are not asked for again', async () => {
        await open(ListView, { sprintLoading: false });
        const pagesBefore = server.calls.filter((stages) => stages.some((stage) => stage.$facet?.result)).length;

        await projectGainsReview();

        const pages = server.calls.filter((stages) => stages.some((stage) => stage.$facet?.result));
        expect(pages.slice(pagesBefore).map((stages) => stages[0].$match.statusKey.$eq)).toEqual([REVIEW.key]);
    });

    it('the Board draws the new column with the task that is in it', async () => {
        await open(BoardView);
        expect(boardColumns()).toEqual({ 'To Do': ['Collect the logins'], Done: ['Sign the contract'] });

        await projectGainsReview();

        expect(boardColumns()).toEqual({ 'To Do': ['Collect the logins'], Review: ['Write the brief'], Done: ['Sign the contract'] });
    });

    it('the Table draws the new group with the task that is in it', async () => {
        await open(TableView);
        expect(tableGroups()).toEqual({ 'To Do': ['Collect the logins'], Done: ['Sign the contract'] });

        await projectGainsReview();

        expect(tableGroups()).toEqual({ 'To Do': ['Collect the logins'], Review: ['Write the brief'], Done: ['Sign the contract'] });
    });

    it('a status that is renamed is renamed in the open List', async () => {
        await open(ListView, { sprintLoading: false });

        project.value = { ...PROJECT, taskStatusData: [{ ...TODO, name: 'Up next' }, DONE] };
        await settle(600);
        await settle(600);

        expect(listGroups()).toEqual({ 'Up next': ['Collect the logins'], Done: ['Sign the contract'] });
    });
});
