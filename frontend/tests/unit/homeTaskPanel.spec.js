import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { route, router, groups, fetchOpen, stub } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    route: { path: '/c1/home', name: 'Home', query: {}, params: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
    groups: { today: [], overdue: [], next: [], unscheduled: [] },
    fetchOpen: vi.fn(() => Promise.resolve())
}));

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })), apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));
vi.mock('@/views/TaskDetail/TaskDetail.vue', () => stub('TaskDetailAdapter'));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => stub('CreateProjectSidebar'));
vi.mock('@/components/molecules/Home/HomeSidebar.vue', () => stub('HomeSidebar'));
vi.mock('@/components/molecules/Home/AgendaCard.vue', () => stub('AgendaCard'));
vi.mock('@/components/molecules/Home/PlannerPanel.vue', () => stub('PlannerPanel'));
vi.mock('@/components/molecules/Home/TimerChip.vue', () => stub('TimerChip'));
vi.mock('@/components/molecules/Home/SetupChecklist.vue', () => stub('SetupChecklist'));
vi.mock('@/components/molecules/Home/HomeCardsMenu.vue', () => stub('HomeCardsMenu'));
vi.mock('@/components/molecules/Home/WaitingOnYouCard.vue', () => stub('WaitingOnYouCard'));
vi.mock('@/components/molecules/Home/StandupCard.vue', () => stub('StandupCard'));
vi.mock('@/components/molecules/Home/StatusChip.vue', () => stub('StatusChip'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar'));
vi.mock('@/components/molecules/Home/homeCards', () => ({ isHomeCardShown: () => false, setHomeCardShown: vi.fn(), syncHomeCards: vi.fn() }));
vi.mock('@/composable/blockingSurface', () => ({ useBlockingSurface: () => ref(false) }));
vi.mock('@/composable/useOnboardingChecklist', () => ({
    useOnboardingChecklist: () => ({
        steps: ref([]), show: ref(false), complete: ref(true), isOwnerOrAdmin: ref(false), dismiss: vi.fn(),
        sampleProject: ref(null), removingSample: ref(false), mark: vi.fn(), onAction: vi.fn(), removeSample: vi.fn()
    })
}));
vi.mock('@/components/molecules/Home/useTimer', () => ({
    useTimer: () => ({ timer: { active: null }, isTracking: () => false, start: vi.fn(), pause: vi.fn(), stop: vi.fn() })
}));
vi.mock('@/components/molecules/Home/useAgenda', () => ({
    useAgenda: () => ({ connected: ref(false), itemsFor: () => [], load: () => Promise.resolve(), removeFocus: vi.fn() })
}));
vi.mock('@/components/molecules/Home/useMyWork', () => ({
    useMyWork: () => ({
        loading: ref(false), loaded: ref(true), groups: ref(groups), sortBy: ref('priority'),
        done: ref([]), doneLoaded: ref(true), delegated: ref([]), assignedCount: ref(0), mine: ref([]), openTasks: ref([]),
        projectOf: () => null, setSort: vi.fn(), fetchOpen, fetchDone: vi.fn()
    })
}));

import TodayOverdue from '@/views/Home/TodayOverdue.vue';
import { bindRouter, closeTask, overlayState, stepTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const task = (id, extra = {}) => ({ _id: id, TaskName: `Task ${id}`, ProjectID: 'p1', sprintId: 's1', ...extra });

let wrapper;
beforeEach(() => {
    route.query = {};
    router.replace.mockClear();
    router.push.mockClear();
    fetchOpen.mockClear();
    groups.today = [task('t1')];
    groups.overdue = [task('t2', { ProjectID: 'p2', sprintId: 's2', folderObjId: 'f2' })];
    groups.next = [task('t3')];
    groups.unscheduled = [];
    bindRouter(router, route);
    wrapper = mount(TodayOverdue, { attachTo: document.body });
});

afterEach(() => {
    closeTask({ keepRoute: true });
    wrapper.unmount();
});

const rowTitle = (id) => wrapper.findAll('.hc-row__title').find((b) => b.text() === `Task ${id}`);

describe('Home opens a task in the side panel', () => {
    it('opens the overlay panel with ?task= on the current route, not the legacy detail', async () => {
        await rowTitle('t2').trigger('click');
        await flushPromises();

        expect(wrapper.findComponent({ name: 'TaskDetailAdapter' }).exists()).toBe(false);
        expect(overlayState.open).toBe(true);
        expect(overlayState.current).toMatchObject({ taskId: 't2', projectId: 'p2', sprintId: 's2', folderId: 'f2', companyId: 'company-1' });
        const call = router.replace.mock.calls.at(-1)?.[0] || router.push.mock.calls.at(-1)?.[0];
        expect(call).toEqual({ query: { task: 't2' } });
    });

    it('steps through tasks in the order My Work shows them', async () => {
        await rowTitle('t2').trigger('click');
        await flushPromises();

        expect(overlayState.nav).toMatchObject({ index: 1, total: 3 });
        expect(overlayState.nav.prev.taskId).toBe('t1');
        expect(overlayState.nav.next.taskId).toBe('t3');

        stepTask(1);
        expect(overlayState.current.taskId).toBe('t3');
        expect(overlayState.nav.next).toBeNull();
    });

    it('refreshes My Work once the panel closes', async () => {
        await rowTitle('t1').trigger('click');
        await flushPromises();
        fetchOpen.mockClear();

        closeTask();
        await flushPromises();

        expect(fetchOpen).toHaveBeenCalled();
    });
});
