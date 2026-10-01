/* The List pages a group past its first 35 tasks, and asks for the first page at once.
   The real ListView, the real loader (taskListHelper) and the real store action run here;
   only the HTTP layer is a stand-in, which answers the task queries as the server would. */
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
    const sorted = (rows, order) => [...rows].sort((a, b) => {
        for (const field of Object.keys(order)) {
            if (a[field] !== b[field]) return (a[field] > b[field] ? 1 : -1) * order[field];
        }
        return 0;
    });
    const answer = (stages) => {
        const match = stages.find((stage) => stage.$match)?.$match || {};
        const facet = stages.find((stage) => stage.$facet)?.$facet;
        if (!facet) return [];
        const rows = sorted(server.tasks.filter((task) => matches(task, match)), stages.find((stage) => stage.$sort)?.$sort || {});
        if (facet.result) {
            const skip = facet.result.find((stage) => '$skip' in stage)?.$skip || 0;
            const limit = facet.result.find((stage) => '$limit' in stage)?.$limit || rows.length;
            return [{ result: rows.slice(skip, skip + limit).map((task) => ({ ...task })), count: rows.length ? [{ count: rows.length }] : [] }];
        }
        return [Object.fromEntries(Object.entries(facet).map(([name, pipeline]) => {
            const count = rows.filter((task) => matches(task, pipeline[0].$match)).length;
            return [name, count ? [{ count }] : []];
        }))];
    };
    return {
        apiRequest: vi.fn((method, url, body) => {
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
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), useTaskSequenceSource: () => {} }));

import Store from '@/store/index';
import ListView from '@/views/Projects/ListView/ListView.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const PAGE = 35;
const TODO = { key: 1, name: 'To Do', type: 'default_active', value: 'todo', textColor: '#777', bgColor: '#eee' };
const DONE = { key: 2, name: 'Done', type: 'close', value: 'done', textColor: '#2a2', bgColor: '#e2f7e2' };
const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'Scale Test', ProjectCode: 'SC', isGlobalPermission: true, isPrivateSpace: false,
    lastTaskId: 110, AssigneeUserId: ['u1'], taskStatusData: [TODO, DONE], apps: [], sprintsObj: { [SPRINT]: { id: SPRINT, name: 'List' } }
};
const sprints = () => [{ id: SPRINT, name: 'List', projectId: PID, tasks: 110, deletedStatusKey: 0 }];

const pad = (n) => String(n).padStart(3, '0');
const task = (n, statusKey) => ({
    _id: `t${pad(n)}`, TaskName: `Task ${pad(n)}`, TaskKey: `SC-${n}`, ProjectID: PID, sprintId: SPRINT, isParentTask: true,
    statusKey, statusType: statusKey === 2 ? 'close' : 'default_active', groupByStatusIndex: n, createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString(),
    AssigneeUserId: [], deletedStatusKey: 0, subTasks: 0
});
const seedServer = () => {
    server.tasks = [...Array.from({ length: 100 }, (_, i) => task(i + 1, 1)), ...Array.from({ length: 10 }, (_, i) => task(i + 101, 2))];
    server.calls = [];
};

function seedStore() {
    Store.state.settings.companies = [{ _id: 'c1', planFeature: { listView: true } }];
    Store.state.settings.selectedCompanyId = 'c1';
    Store.state.settings.companyPriority = [{ name: 'High', value: 'HIGH', statusImage: '' }, { name: 'Low', value: 'LOW', statusImage: '' }];
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType: 1 };
    Store.state.settings.rules = { task: {} };
    Store.state.settings.companyUsers = [{ _id: 'cu-u1', userId: 'u1', isDelete: false }];
    Store.state.settings.socketInstance = { id: 'sock', emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    Store.state.users.users = [{ _id: 'u1', Employee_Name: 'Olivia Owner' }];
    Store.state.projectData.tasks = {};
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
const scrollIntoView = (el) => observers
    .filter((observer) => observer.targets.has(el))
    .forEach((observer) => observer.callback([{ isIntersecting: true, target: el }]));

const RowStub = defineComponent({
    name: 'ListRow',
    props: { data: Object, isSub: Boolean, selected: Boolean, canSelect: Boolean },
    setup: (props) => () => h('div', { class: props.isSub ? 'row-sub' : 'row', 'data-id': props.data._id, 'data-selected': String(props.selected) }, props.data.TaskName)
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});
const SortStub = defineComponent({ name: 'ListSortControl', emits: ['key', 'dir'], setup: () => () => h('div') });

const settle = async (ms = 0) => {
    await flushPromises();
    if (ms) vi.advanceTimersByTime(ms);
    await flushPromises();
};

let wrapper;
let searched;

async function openList(props = {}) {
    searched = ref(false);
    const project = ref(PROJECT);
    wrapper = mount(ListView, {
        attachTo: document.body,
        props: { grouped: 0, sprints: sprints(), sprintLoading: false, ...props },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: {
                selectedProject: project, $clientWidth: ref(1280), $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'),
                showArchived: ref(false), searchedTask: searched, taskCollapsed: ref(true), clearTaskFilters: () => {},
                $defaultUserAvatar: ref(''), $defaultGhostCustomUserImg: ref(''), $defaultTaskStatusImg: ref('')
            },
            stubs: {
                ListRow: RowStub, draggable: DraggableStub, ListSortControl: SortStub, UpgradePlan: true, SprintListing: true, Skelaton: true,
                ListBulkBar: true, CreateTask: true, EmptyState: true, ViewColumnChooser: true, ViewDensityControl: true, AiFieldColumnHead: true,
                ConvertToSubTaskSidebar: true, TaskMenuSidebars: true
            }
        }
    });
    await settle();
    return wrapper;
}

const group = (name) => wrapper.findAll('.lv2__group').find((el) => el.find('.lv2__group-name').text() === name);
const rowIds = (name) => group(name).findAll('.row').map((row) => row.attributes('data-id'));
const rowNames = (name) => group(name).findAll('.row').map((row) => row.text());
const headerCount = (name) => group(name).find('.lv2__group-meta').text();
const more = (name) => group(name).find('.lv2__more');
const moreButton = (name) => group(name).find('.lv2__more-btn');
const loadMore = async (name) => {
    await moreButton(name).trigger('click');
    await settle();
};

const pageCalls = () => server.calls.filter((stages) => stages.some((stage) => stage.$facet?.result));
const pagesFor = (statusKey) => pageCalls().filter((stages) => stages[0].$match.statusKey?.$eq === statusKey);
const skipOf = (stages) => stages.find((stage) => stage.$facet).$facet.result.find((stage) => '$skip' in stage).$skip;
const expectedIds = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `t${pad(from + i)}`);

beforeEach(() => {
    /* setImmediate stays real: flushPromises waits on it. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    observers = [];
    window.IntersectionObserver = FakeIntersectionObserver;
    seedServer();
    seedStore();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the list opens without a wait', () => {
    it('asks for the first page of every group as soon as it mounts', async () => {
        await openList();
        expect(pagesFor(1).map(skipOf)).toEqual([0]);
        expect(pagesFor(2).map(skipOf)).toEqual([0]);
        expect(rowIds('To Do')).toHaveLength(PAGE);
    });

    it('asks only once, however often the page tells it to load on the way in', async () => {
        await openList({ sprintLoading: true });
        expect(pageCalls()).toHaveLength(0);

        await wrapper.setProps({ sprintLoading: false });
        await wrapper.setProps({ sprints: sprints() });
        await wrapper.setProps({ sprintLoading: true });
        await wrapper.setProps({ sprintLoading: false });
        await settle(2000);
        await settle(2000);

        expect(pagesFor(1).map(skipOf)).toEqual([0]);
        expect(pagesFor(2).map(skipOf)).toEqual([0]);
    });

    it('still loads when the group-by changes afterwards', async () => {
        await openList();
        server.calls = [];
        await wrapper.setProps({ grouped: 2 });
        await settle(2000);
        expect(server.calls.length).toBeGreaterThan(0);
    });

    it('coming back to a list it already holds keeps the rows and asks for the counts, not for more pages', async () => {
        await openList();
        await loadMore('To Do');
        wrapper.unmount();
        server.calls = [];
        server.tasks = server.tasks.filter((row) => row._id !== 't100');

        await openList();
        await settle(1000);

        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
        expect(pageCalls()).toHaveLength(0);
        expect(server.calls).toHaveLength(1);
        expect(headerCount('To Do')).toBe('99');
    });
});

describe('a group loads all of its tasks', () => {
    beforeEach(async () => { await openList(); });

    it('shows the first 35 of 100 and says how many are left', () => {
        expect(rowIds('To Do')).toEqual(expectedIds(1, 35));
        expect(headerCount('To Do')).toBe('100');
        expect(moreButton('To Do').text()).toBe('Load more (65 left)');
    });

    it('loads the next pages on demand, in order, with no duplicate and no missing row', async () => {
        await loadMore('To Do');
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
        expect(moreButton('To Do').text()).toBe('Load more (30 left)');

        await loadMore('To Do');
        expect(rowIds('To Do')).toEqual(expectedIds(1, 100));
        expect(new Set(rowIds('To Do')).size).toBe(100);
        expect(more('To Do').exists()).toBe(false);
    });

    it('asks for each page with the same query and the same total order', async () => {
        await loadMore('To Do');
        await loadMore('To Do');
        const pages = pagesFor(1);
        expect(pages.map(skipOf)).toEqual([0, 35, 70]);
        pages.forEach((stages) => {
            expect(stages[0]).toEqual(pages[0][0]);
            expect(stages[1]).toEqual({ $sort: { groupByStatusIndex: 1, createdAt: 1, _id: 1 } });
        });
    });

    it('keeps the server total in the header while pages arrive', async () => {
        await loadMore('To Do');
        expect(headerCount('To Do')).toBe('100');
        await loadMore('To Do');
        expect(headerCount('To Do')).toBe('100');
        expect(headerCount('Done')).toBe('10');
    });

    it('loads the next page when the end of the group scrolls into view', async () => {
        scrollIntoView(more('To Do').element);
        await settle();
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
    });

    it('asks once for a page, however often the end of the group comes into view', async () => {
        const end = more('To Do').element;
        scrollIntoView(end);
        scrollIntoView(end);
        moreButton('To Do').trigger('click');
        await settle();
        expect(pagesFor(1).map(skipOf)).toEqual([0, 35]);
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
    });

    it('misses no task when a loaded row leaves the group between pages', async () => {
        const moved = server.tasks.find((row) => row._id === 't010');
        Object.assign(moved, { statusKey: 2, statusType: 'close' });
        Store.commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null, op: 'modified', pid: PID, sprintId: SPRINT, data: { ...moved }, updatedFields: { statusKey: 2, statusType: 'close' }
        });
        await settle();
        expect(headerCount('To Do')).toBe('99');

        await loadMore('To Do');
        expect(skipOf(pagesFor(1)[1])).toBe(34);
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70).filter((id) => id !== 't010'));
    });

    it('misses no task when a new one is added to the end of the group between pages', async () => {
        const created = { ...task(999, 1), groupByStatusIndex: 999 };
        server.tasks.push(created);
        Store.commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null, op: 'added', pid: PID, sprintId: SPRINT, data: { ...created }, updatedFields: { ...created }
        });
        await settle();
        expect(rowIds('To Do')).toEqual([...expectedIds(1, 35), 't999']);
        expect(headerCount('To Do')).toBe('101');

        await loadMore('To Do');
        expect(skipOf(pagesFor(1)[1])).toBe(35);
        expect(rowIds('To Do')).toEqual([...expectedIds(1, 70), 't999']);
        expect(moreButton('To Do').text()).toBe('Load more (30 left)');
    });

    it('offers no more for a group that is fully loaded', () => {
        expect(rowIds('Done')).toEqual(expectedIds(101, 110));
        expect(more('Done').exists()).toBe(false);
    });

    it('keeps the loaded rows when the group is collapsed and opened again', async () => {
        await loadMore('To Do');
        const before = pageCalls().length;

        await group('To Do').find('.lv2__group-head').trigger('click');
        expect(group('To Do')).toBeUndefined();
        await wrapper.findAll('.lv2__collapsed-item').find((el) => el.text().includes('To Do')).trigger('click');
        await settle();

        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
        expect(headerCount('To Do')).toBe('100');
        expect(moreButton('To Do').text()).toBe('Load more (30 left)');
        expect(pageCalls()).toHaveLength(before);
    });
});

describe('paging under a sort and a filter', () => {
    beforeEach(async () => { await openList(); });

    const sortByNameDescending = async () => {
        const control = wrapper.findComponent(SortStub);
        control.vm.$emit('key', 'name');
        control.vm.$emit('dir', 'desc');
        await settle();
    };

    it('sorts the loaded rows, says so, and takes the next page in the same server order', async () => {
        await sortByNameDescending();
        expect(rowIds('To Do')).toEqual(expectedIds(1, 35).reverse());
        expect(group('To Do').find('.lv2__more-hint').text()).toBe('Only the 35 loaded tasks are sorted.');

        await loadMore('To Do');
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70).reverse());
        expect(new Set(rowIds('To Do')).size).toBe(70);
        expect(pagesFor(1)[1][1]).toEqual({ $sort: { groupByStatusIndex: 1, createdAt: 1, _id: 1 } });

        await loadMore('To Do');
        expect(rowIds('To Do')).toEqual(expectedIds(1, 100).reverse());
        expect(group('To Do').find('.lv2__more-hint').exists()).toBe(false);
    });

    it('gives rows with equal sort values the same order on every render', async () => {
        server.tasks.filter((row) => row.statusKey === 1).forEach((row) => { row.groupByStatusIndex = 0; row.createdAt = '2026-09-01T00:00:00.000Z'; });
        Store.state.projectData.tasks = {};
        wrapper.unmount();
        await openList();
        await loadMore('To Do');
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
    });

    it('shows every match of a filter at once, and keeps the pages it had when the filter is cleared', async () => {
        await loadMore('To Do');
        Store.state.projectData.searchedTasks = server.tasks.filter((row) => row.statusKey === 1).slice(40, 90).map((row) => ({ ...row }));
        searched.value = true;
        await settle();
        expect(rowNames('To Do')).toHaveLength(50);
        expect(headerCount('To Do')).toBe('50');
        expect(more('To Do').exists()).toBe(false);

        searched.value = false;
        Store.state.projectData.searchedTasks = [];
        await settle();
        expect(rowIds('To Do')).toEqual(expectedIds(1, 70));
        expect(headerCount('To Do')).toBe('100');
        expect(moreButton('To Do').text()).toBe('Load more (30 left)');
    });
});

describe('selecting a group that is not fully loaded', () => {
    beforeEach(async () => { await openList(); });

    const selectAll = (name) => group(name).find('input.lv2__group-check');

    it('selects the loaded rows, and its name says that more exist', async () => {
        expect(selectAll('To Do').attributes('aria-label')).toBe('Select the 35 loaded tasks in this group (100 in all)');
        await selectAll('To Do').setValue(true);
        expect([...Store.state.taskSelection.selectedTaskIds].sort()).toEqual(expectedIds(1, 35));
    });

    it('shows as partly selected once more rows load, and selects those on the next click', async () => {
        await selectAll('To Do').setValue(true);
        await loadMore('To Do');
        expect(selectAll('To Do').element.indeterminate).toBe(true);
        await selectAll('To Do').trigger('change');
        expect([...Store.state.taskSelection.selectedTaskIds].sort()).toEqual(expectedIds(1, 70));
    });

    it('names the whole group once everything is loaded', async () => {
        expect(selectAll('Done').attributes('aria-label')).toBe('Select every task in this group');
        await selectAll('Done').setValue(true);
        expect([...Store.state.taskSelection.selectedTaskIds].sort()).toEqual(expectedIds(101, 110));
    });
});

describe('a change to a task that is not loaded', () => {
    beforeEach(async () => { await openList(); });

    const fromSocket = (op, data, updatedFields) => Store.commit('projectData/mutateUpdateFirebaseTasks', {
        snap: {}, op, pid: PID, sprintId: SPRINT, data: { ...data }, updatedFields: { ...updatedFields }
    });

    it('moving it to another status leaves both header counts right', async () => {
        const moved = server.tasks.find((row) => row._id === 't090');
        Object.assign(moved, { statusKey: 2, statusType: 'close' });
        fromSocket('modified', moved, { statusKey: 2, statusType: 'close' });
        await settle(1000);

        expect(headerCount('To Do')).toBe('99');
        expect(headerCount('Done')).toBe('11');
        expect(moreButton('To Do').text()).toBe('Load more (64 left)');
    });

    it('deleting it lowers the count and what is left to load', async () => {
        const gone = server.tasks.find((row) => row._id === 't095');
        server.tasks = server.tasks.filter((row) => row !== gone);
        fromSocket('removed', gone, {});
        await settle(1000);

        expect(headerCount('To Do')).toBe('99');
        expect(moreButton('To Do').text()).toBe('Load more (64 left)');
    });

    it('recounts with one request, whatever number of changes arrive together', async () => {
        const before = server.calls.length;
        ['t080', 't081', 't082'].forEach((id) => {
            const moved = server.tasks.find((row) => row._id === id);
            Object.assign(moved, { statusKey: 2, statusType: 'close' });
            fromSocket('modified', moved, { statusKey: 2, statusType: 'close' });
        });
        await settle(1000);

        expect(server.calls.length - before).toBe(1);
        expect(headerCount('To Do')).toBe('97');
        expect(headerCount('Done')).toBe('13');
    });
});
