/* Task 047, T-4: "Group by who is working". The List, the Board and the Table draw one group for each agent at work,
   named as the row mark names it, and one for the tasks no agent holds, and the groups follow a claim without a
   reload. The real views, the real loader (taskListHelper) and the real store run here; only the HTTP layer is a
   stand-in, which answers the task queries as the server would. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

/* `hidden` are the tasks this viewer's role keeps from them: the server leaves them out of every answer. */
const { server } = vi.hoisted(() => ({ server: { tasks: [], calls: [], hidden: [], tabReturns: [] } }));

vi.mock('@/services', () => {
    const holds = (have, want) => {
        if (want && typeof want === 'object' && !Array.isArray(want)) {
            if ('objId' in want) return holds(have, want.objId);
            if ('$eq' in want) return have === want.$eq;
            if ('$in' in want) return want.$in.includes(have);
            if ('$nin' in want) return !want.$nin.includes(have);
        }
        return have === want;
    };
    const matches = (task, condition = {}) => Object.entries(condition).every(([field, want]) => {
        if (field === '$and') return want.every((part) => matches(task, part));
        if (field === 'objId') return Object.entries(want).every(([key, value]) => task[key] === value);
        return holds(task[field], want);
    });
    const shown = (match) => server.tasks.filter((task) => !server.hidden.includes(task._id) && matches(task, match));
    /* A tab that comes back asks for what changed in each group while it was away, and for the group's count. */
    const tabAnswer = (body) => {
        const group = body.item?.mongoConditions?.[0] || body.item?.conditions?.[0] || {};
        const count = shown({ ProjectID: body.pid, sprintId: body.sprintId, ...group }).length;
        return body.istableTask ? [] : [{ result: [], count: count ? [{ count }] : [] }];
    };
    const answer = (stages) => {
        const rows = shown(stages.find((stage) => stage.$match)?.$match || {});
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
            if (String(url).endsWith('/tabSyncTask')) {
                server.tabReturns.push(body);
                return Promise.resolve({ status: 200, data: tabAnswer(body) });
            }
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
import { heldTasks, openRuns } from '@/views/Ai/agentFeed';
import { agentWorkIn } from '@/views/Projects/composables/agentWork';
import { agentWorkGroups, inAgentWorkGroup } from '@/views/Projects/composables/agentWorkQuery';
import { taskInGroup } from '@/views/Projects/ListView/listFilter';
import { tabSyncHelper } from '@/utils/tabSyncs';
import { AGENT_WORK_GROUP } from '@viewSettings';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const TODO = { key: 1, name: 'To Do', type: 'default_active', value: 'todo', textColor: '#777', bgColor: '#eee' };
const DONE = { key: 2, name: 'Done', type: 'close', value: 'done', textColor: '#2a2', bgColor: '#e2f7e2' };
const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'Kickoff', ProjectCode: 'KO', isGlobalPermission: true, isPrivateSpace: false,
    lastTaskId: 3, AssigneeUserId: ['u1'], taskStatusData: [TODO, DONE], apps: [], sprintsObj: { [SPRINT]: { id: SPRINT, name: 'Backlog' } }
};
const sprints = () => [{ id: SPRINT, name: 'Backlog', projectId: PID, tasks: 3, deletedStatusKey: 0 }];
const task = (n, statusKey, name) => ({
    _id: `t${n}`, TaskName: name, TaskKey: `KO-${n}`, ProjectID: PID, sprintId: SPRINT, isParentTask: true,
    statusKey, groupByStatusIndex: n, createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString(),
    AssigneeUserId: [], deletedStatusKey: 0, subTasks: 0
});
const SINCE = '2026-10-02T08:42:00.000Z';
const PRIYAS_CLAUDE = 'Claude, for Priya';
const claim = (taskId, over = {}) => ({ taskId, projectId: PID, name: PRIYAS_CLAUDE, since: SINCE, ...over });
const run = (taskId, over = {}) => ({ _id: `r-${taskId}`, agentId: 'a1', agentName: 'Reviewer', status: 'running', taskId, projectId: PID, startedAt: SINCE, ...over });

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
    Store.state.projectData.getTableTaskPayload = [];
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
        props: { grouped: AGENT_WORK_GROUP, sprints: sprints(), ...props },
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

const NO_AGENT = en.AgentWork.group_none;
const pairs = (selector, nameOf, rowSelector) => wrapper.findAll(selector).map((el) => [nameOf(el), el.findAll(rowSelector).map((row) => row.text())]);
const VIEWS = [
    ['List', ListView, { sprintLoading: false }, () => pairs('.lv2__group', (el) => el.find('.lv2__group-name').text(), '.row')],
    ['Board', BoardView, {}, () => pairs('.column', (el) => el.attributes('data-name'), '.card')],
    ['Table', TableView, {}, () => pairs('[role="rowgroup"]', (el) => el.find('.ah-chip').text(), '.table-row')]
];
const pageCalls = () => server.calls.filter((stages) => stages.some((stage) => stage.$facet?.result));

async function agentsMove(change) {
    change();
    await settle(600);
    bringEveryGroupIntoView();
    await settle(600);
    await settle(600);
}

/* What App.vue does when the browser tab is shown again while a list of the project is open. */
async function returnToTab() {
    sessionStorage.setItem('joinedRooms', JSON.stringify([`project_sprint_${PID}_${SPRINT}`]));
    sessionStorage.setItem('tableaveTime', String(Date.now()));
    let tabSync;
    const Shell = defineComponent({ setup() { ({ tabSync } = tabSyncHelper()); return () => h('i'); } });
    const shell = mount(Shell, { global: { plugins: [Store] } });
    tabSync();
    await settle(600);
    shell.unmount();
}

beforeEach(() => {
    /* setImmediate stays real: flushPromises waits on it. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    observers = [];
    window.IntersectionObserver = FakeIntersectionObserver;
    server.tasks = [task(1, TODO.key, 'Collect the logins'), task(2, DONE.key, 'Sign the contract'), task(3, TODO.key, 'Write the brief')];
    server.calls = [];
    server.hidden = [];
    server.tabReturns = [];
    sessionStorage.clear();
    heldTasks.value = [];
    openRuns.value = [];
    seedStore();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the groups of "who is working"', () => {
    it('are one for each agent at work in the project, under the name its mark shows, and one for every other task', () => {
        heldTasks.value = [claim('t2'), claim('t1'), claim('t9', { projectId: 'p2', name: 'Cursor, for Ben' })];
        openRuns.value = [run('t3'), run('t4', { status: 'waiting_approval' })];

        const work = agentWorkIn(PID);
        expect(work).toEqual([{ taskId: 't1', name: PRIYAS_CLAUDE }, { taskId: 't2', name: PRIYAS_CLAUDE }, { taskId: 't3', name: 'Reviewer' }]);

        const groups = agentWorkGroups(work, NO_AGENT);
        expect(groups.map((group) => [group.name, group.taskIds])).toEqual([[PRIYAS_CLAUDE, ['t1', 't2']], ['Reviewer', ['t3']], [NO_AGENT, ['t1', 't2', 't3']]]);
        expect(groups.map((group) => group.conditions[0])).toEqual([
            { _id: { objId: { $in: ['t1', 't2'] } } },
            { _id: { objId: { $in: ['t3'] } } },
            { _id: { objId: { $nin: ['t1', 't2', 't3'] } } }
        ]);
        expect(groups.every((group) => group.dropDisabled)).toBe(true);
    });

    it('are read under a new name by the store when the tasks an agent holds change, and under the same one when they do not', () => {
        const keyOf = (work) => agentWorkGroups(work, NO_AGENT).map((group) => group.searchValue);
        const one = [{ taskId: 't1', name: PRIYAS_CLAUDE }];
        expect(keyOf(one)).toEqual(keyOf([...one]));
        expect(keyOf(one)[0]).not.toBe(keyOf([...one, { taskId: 't2', name: PRIYAS_CLAUDE }])[0]);
        expect(keyOf(one)[1]).toBe(keyOf([])[0]);
    });

    it('place each of 10,000 rows in one group, from the one read the marks use', () => {
        const rows = Array.from({ length: 10000 }, (_, n) => ({ _id: `t${n}` }));
        heldTasks.value = [claim('t7'), claim('t4200'), claim('t9999', { name: 'Cursor, for Ben' })];
        const groups = agentWorkGroups(agentWorkIn(PID), NO_AGENT);
        const counts = groups.map((group) => rows.filter((row) => taskInGroup(row, group)).length);
        expect(counts).toEqual([2, 1, 9997]);
        expect(rows.every((row) => groups.filter((group) => inAgentWorkGroup(row, group)).length === 1)).toBe(true);
        expect(server.calls).toEqual([]);
    });
});

describe.each(VIEWS)('the %s grouped by who is working', (name, view, props, groups) => {
    it('draws a group for each agent at work and one for the tasks no agent holds', async () => {
        heldTasks.value = [claim('t1')];
        openRuns.value = [run('t2')];
        await open(view, props);
        expect(groups()).toEqual([[PRIYAS_CLAUDE, ['Collect the logins']], ['Reviewer', ['Sign the contract']], [NO_AGENT, ['Write the brief']]]);
    });

    it('follows an agent that takes a task and lets it go, without a reload', async () => {
        await open(view, props);
        expect(groups()).toEqual([[NO_AGENT, ['Collect the logins', 'Sign the contract', 'Write the brief']]]);

        await agentsMove(() => { heldTasks.value = [claim('t2')]; });
        expect(groups()).toEqual([[PRIYAS_CLAUDE, ['Sign the contract']], [NO_AGENT, ['Collect the logins', 'Write the brief']]]);

        await agentsMove(() => { heldTasks.value = []; });
        expect(groups()).toEqual([[NO_AGENT, ['Collect the logins', 'Sign the contract', 'Write the brief']]]);
    });

    it('leaves out an agent that works in another project', async () => {
        heldTasks.value = [claim('t1', { projectId: 'p2' })];
        await open(view, props);
        expect(groups().map(([group]) => group)).toEqual([NO_AGENT]);
    });

    it('names an agent only to a viewer who has a task of its group', async () => {
        heldTasks.value = [claim('t1')];
        server.hidden = ['t1'];
        await open(view, props);
        expect(groups()).toEqual([[NO_AGENT, ['Sign the contract', 'Write the brief']]]);
        expect(wrapper.text()).not.toContain(PRIYAS_CLAUDE);

        wrapper.unmount();
        server.hidden = [];
        seedStore();
        await open(view, props);
        expect(groups()).toEqual([[PRIYAS_CLAUDE, ['Collect the logins']], [NO_AGENT, ['Sign the contract', 'Write the brief']]]);
    });

    it('asks for each group it draws once when its tab comes back, however often the agents moved', async () => {
        await open(view, props);
        await agentsMove(() => { heldTasks.value = [claim('t1')]; });
        await agentsMove(() => { heldTasks.value = [claim('t1'), claim('t2')]; });
        await agentsMove(() => { heldTasks.value = [claim('t1'), claim('t2'), claim('t3')]; });

        await returnToTab();

        const drawn = agentWorkGroups(agentWorkIn(PID), NO_AGENT).map((group) => group.searchValue);
        expect(server.tabReturns.map((body) => body.item.searchValue).sort()).toEqual(drawn.slice().sort());
    });
});

describe('a tab that comes back to a List grouped by who is working', () => {
    const counts = () => {
        const found = Store.state.projectData.tasks[PID][SPRINT].found;
        return agentWorkGroups(agentWorkIn(PID), NO_AGENT).map((group) => [group.name, found[`${group.searchKey}_${group.searchValue}`]]);
    };

    it('keeps the count of every group', async () => {
        heldTasks.value = [claim('t2')];
        await open(ListView, { sprintLoading: false });
        expect(counts()).toEqual([[PRIYAS_CLAUDE, 1], [NO_AGENT, 2]]);

        await returnToTab();

        expect(server.tabReturns.map((body) => body.item.conditions[0]._id)).toEqual([{ objId: { $in: ['t2'] } }, { objId: { $nin: ['t2'] } }]);
        expect(counts()).toEqual([[PRIYAS_CLAUDE, 1], [NO_AGENT, 2]]);
    });
});

describe('what the grouping asks the server for', () => {
    it('is one page for each group, and only the group that changed when an agent takes a task', async () => {
        await open(ListView, { sprintLoading: false });
        expect(pageCalls().map((stages) => stages[0].$match._id)).toEqual([{ objId: { $nin: [] } }]);
        const before = pageCalls().length;

        await agentsMove(() => { heldTasks.value = [claim('t2')]; });

        expect(pageCalls().slice(before).map((stages) => stages[0].$match._id)).toEqual([{ objId: { $in: ['t2'] } }]);
    });
});
