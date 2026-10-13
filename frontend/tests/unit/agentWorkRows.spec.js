/* Task 047, T-4: a task an agent holds or is working on carries one mark in List and Table, saying who and since
   when, and "an agent is working on it" narrows the views through the task search they already share. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createStore } from 'vuex';

vi.mock('@/composable', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        useCustomComposable: () => ({ ...real.useCustomComposable(), checkPermission: () => true, checkApps: () => true, debounce: (fn) => fn }),
        useGetterFunctions: () => ({ ...real.useGetterFunctions(), getUser: () => null, getTaskStatus: () => ({ name: 'To do' }) })
    };
});
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({
    useTaskSummaries: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({
    useTaskCategories: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));

import ListRow from '@/views/Projects/ListView/ListRow.vue';
import TableRow from '@/views/Projects/TableView/TableRow.vue';
import TaskAgentMark from '@/views/Projects/components/TaskAgentMark.vue';
import { followClockPrefs } from '@/utils/clockText';
import { heldTasks, openRuns } from '@/views/Ai/agentFeed';
import { agentTaskIds, agentWorkFor } from '@/views/Projects/composables/agentWork';
import { agentWorkMatch } from '@/views/Projects/composables/agentWorkQuery';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';

const SINCE = '2026-10-02T08:42:00.000Z';
const CLAIM = { taskId: 't1', projectId: 'p1', name: 'Claude, for Priya', since: SINCE };
const RUN = { _id: 'r1', agentId: 'a1', agentName: 'Reviewer', status: 'running', taskId: 't1', projectId: 'p1', startedAt: SINCE };

const store = createStore({
    getters: {
        'settings/companyPriority': () => [],
        'settings/companyMembers': () => [],
        'settings/teams': () => [],
        'projectData/currentProjectDetails': () => ({}),
        'users/users': () => []
    }
});

const mountRow = async (Row, id = 't1') => {
    const wrapper = mount(Row, {
        props: { data: { _id: id, TaskName: 'Write the release notes', TaskKey: 'SHOP-12', isParentTask: true, statusType: 'active', statusKey: 1, sprintId: 's1', AssigneeUserId: [], tagsArray: [] } },
        global: {
            plugins: [store],
            provide: {
                selectedProject: ref({ _id: 'p1', isGlobalPermission: true, tagsArray: [] }),
                showArchived: ref(false),
                $clientWidth: ref(390),
                $defaultUserAvatar: ref(''),
                $defaultGhostCustomUserImg: ref(''),
                $defaultTaskStatusImg: ref('')
            },
            stubs: { ShellIcon: true, ProvenanceBadge: true, ConfirmationSidebar: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const mark = (wrapper) => wrapper.find('[data-test="agent-mark"]');

beforeEach(() => {
    heldTasks.value = [];
    openRuns.value = [];
});

describe('who is working on a task', () => {
    it('is the connected agent that holds it, or the in-product agent running on it', () => {
        heldTasks.value = [CLAIM, { ...CLAIM, taskId: 't2', name: 'Cursor, for Ben' }];
        openRuns.value = [{ ...RUN, taskId: 't3' }, { ...RUN, _id: 'r2', taskId: 't4', status: 'waiting_approval' }];
        expect(agentWorkFor('t1')).toEqual({ name: 'Claude, for Priya', since: SINCE });
        expect(agentWorkFor('t3')).toEqual({ name: 'Reviewer', since: SINCE });
        expect(agentWorkFor('t4')).toBeNull();
        expect(agentWorkFor('t9')).toBeNull();
        expect(agentTaskIds.value.slice().sort()).toEqual(['t1', 't2', 't3']);
    });
});

describe.each([
    ['List', ListRow],
    ['Table', TableRow]
])('the mark on a %s row', (_, Row) => {
    it('names the connected agent that holds the task, for whom, and since when', async () => {
        heldTasks.value = [CLAIM];
        const shown = mark(await mountRow(Row));
        expect(shown.exists()).toBe(true);
        expect(shown.text()).toContain('Claude, for Priya');
        expect(shown.attributes('role')).toBe('img');
        expect(shown.attributes('aria-label')).toContain('AgentWork.mark_label');
        expect(shown.attributes('title')).toBe(shown.attributes('aria-label'));
    });

    it('names the in-product agent running on the task', async () => {
        openRuns.value = [RUN];
        expect(mark(await mountRow(Row)).text()).toContain('Reviewer');
    });

    it('appears and clears as the agent takes the task and lets it go', async () => {
        const wrapper = await mountRow(Row);
        expect(mark(wrapper).exists()).toBe(false);
        heldTasks.value = [CLAIM];
        await nextTick();
        expect(mark(wrapper).exists()).toBe(true);
        heldTasks.value = [];
        await nextTick();
        expect(mark(wrapper).exists()).toBe(false);
    });

    it('is absent from a row the server sent no word about', async () => {
        heldTasks.value = [{ ...CLAIM, taskId: 'hidden-task' }];
        expect(mark(await mountRow(Row)).exists()).toBe(false);
    });
});

describe('the mark', () => {
    const shownFor = () => mount(TaskAgentMark, { props: { taskId: 't1' } });

    const sinceShown = (since) => {
        heldTasks.value = [{ ...CLAIM, since }];
        return shownFor().find('.tam__since').text();
    };

    it('says the time alone for today and the day with it otherwise', () => {
        vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
        try {
            followClockPrefs({ timeFormat: '24' });
            expect(sinceShown(new Date(2026, 9, 2, 9, 5).toISOString())).toBe('09:05');
            expect(sinceShown('2026-03-04T09:05:00')).toBe('4 Mar, 09:05');
            followClockPrefs({ timeFormat: '12' });
            expect(sinceShown(new Date(2026, 9, 2, 9, 5).toISOString())).toBe('9:05 AM');
            expect(sinceShown('2026-03-04T14:05:00')).toBe('4 Mar, 2:05 PM');
        } finally {
            vi.useRealTimers();
        }
    });

    it('still names the agent when the start is unknown', () => {
        heldTasks.value = [{ ...CLAIM, since: null }];
        const shown = shownFor();
        expect(shown.find('.tam__since').exists()).toBe(false);
        expect(shown.attributes('aria-label')).toContain('AgentWork.mark_label_no_time');
    });
});

describe('the filter "an agent is working on it"', () => {
    let dispatch;
    let api;
    let host;

    const mountSearch = () => {
        dispatch = vi.fn(() => Promise.resolve());
        const searchStore = createStore({
            getters: { 'projectData/searchedTasks': () => [] },
            mutations: { 'projectData/mutateSearchTask': () => {} },
            actions: { 'projectData/searchTask': (_ctx, payload) => dispatch(payload) }
        });
        const Host = defineComponent({
            setup() {
                api = useProjectSearch(ref({ _id: 'p1', isGlobalPermission: true }), ref(false));
                return () => h('div');
            }
        });
        host = mount(Host, { global: { plugins: [searchStore] } });
    };
    afterEach(() => host.unmount());
    const lastMatch = () => dispatch.mock.calls.at(-1)[0].query[0].$match.$and;

    it('asks the shared task search for the marked tasks, inside the project', () => {
        heldTasks.value = [CLAIM];
        openRuns.value = [{ ...RUN, taskId: 't3' }];
        mountSearch();
        api.setAgentWorking(true);
        expect(api.agentWorking.value).toBe(true);
        expect(api.searchTask.value).toBe(true);
        expect(lastMatch()).toContainEqual(agentWorkMatch(['t1', 't3']));
        expect(lastMatch()[0].$and[0]).toEqual({ ProjectID: { objId: { $in: ['p1'] } } });
    });

    it('follows the agents: the rows change when one takes a task or lets it go', async () => {
        heldTasks.value = [CLAIM];
        mountSearch();
        api.setAgentWorking(true);
        const before = dispatch.mock.calls.length;
        heldTasks.value = [CLAIM, { ...CLAIM, taskId: 't2' }];
        await nextTick();
        expect(dispatch.mock.calls.length).toBe(before + 1);
        expect(lastMatch()).toContainEqual(agentWorkMatch(['t1', 't2']));
    });

    it('matches nothing while no agent is working, and is off after the filters are cleared', async () => {
        mountSearch();
        api.setAgentWorking(true);
        expect(lastMatch()).toContainEqual({ _id: { objId: { $in: [] } } });
        api.clearAllFilters();
        expect(api.agentWorking.value).toBe(false);
        expect(api.searchTask.value).toBe(false);
        const calls = dispatch.mock.calls.length;
        heldTasks.value = [CLAIM];
        await nextTick();
        expect(dispatch.mock.calls.length).toBe(calls);
    });

    it('combines with "Me"', () => {
        heldTasks.value = [CLAIM];
        mountSearch();
        api.manageFilterUsers('user-1');
        api.setAgentWorking(true);
        expect(lastMatch()).toContainEqual({ AssigneeUserId: { $in: ['user-1'] } });
        expect(lastMatch()).toContainEqual(agentWorkMatch(['t1']));
    });
});
