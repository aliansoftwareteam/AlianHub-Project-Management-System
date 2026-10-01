import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { route, router, groups, getters, perms, onboarding, apiRequest, stub } = await vi.hoisted(async () => {
    const { h, ref: makeRef } = await import('vue');
    return {
        stub: (name) => ({ default: { name, render: () => h('div', { 'data-card': name }) } }),
        route: { path: '/company-1/home', name: 'Home', query: {}, params: {}, fullPath: '/company-1/home' },
        router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: (name) => name === 'inbox' },
        groups: { today: [], overdue: [], next: [], unscheduled: [] },
        getters: {},
        perms: {},
        onboarding: { show: makeRef(false), sampleProject: makeRef(null) },
        apiRequest: vi.fn()
    };
});

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters }) }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true } })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key in perms ? perms[key] : true) }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/plugins/dashboard/cardCatalog', () => ({ catalogEntry: () => null }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => stub('CreateProjectSidebar'));
vi.mock('@/components/molecules/Home/HomeSidebar.vue', () => stub('HomeSidebar'));
vi.mock('@/components/molecules/Home/AgendaCard.vue', () => stub('AgendaCard'));
vi.mock('@/components/molecules/Home/AssignedCommentsCard.vue', () => stub('AssignedCommentsCard'));
vi.mock('@/components/molecules/Home/PlannerPanel.vue', () => stub('PlannerPanel'));
vi.mock('@/components/molecules/Home/TimerChip.vue', () => stub('TimerChip'));
vi.mock('@/components/molecules/Home/SetupChecklist.vue', () => stub('SetupChecklist'));
vi.mock('@/components/molecules/Home/HomeCardsMenu.vue', () => stub('HomeCardsMenu'));
vi.mock('@/components/molecules/Home/WaitingOnYouCard.vue', () => stub('WaitingOnYouCard'));
vi.mock('@/components/molecules/Home/StandupCard.vue', () => stub('StandupCard'));
vi.mock('@/components/molecules/Home/StatusChip.vue', () => stub('StatusChip'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar'));
vi.mock('@/components/molecules/Home/RecentsCard.vue', () => stub('RecentsCard'));
vi.mock('@/components/molecules/Home/GoalsCard.vue', () => stub('GoalsCard'));
vi.mock('@/components/molecules/Home/HomeCatalogCard.vue', () => stub('HomeCatalogCard'));
vi.mock('@/composable/blockingSurface', () => ({ useBlockingSurface: () => ref(false) }));
vi.mock('@/composable/useOnboardingChecklist', () => ({
    useOnboardingChecklist: () => ({
        steps: ref([]), show: onboarding.show, complete: ref(true), isOwnerOrAdmin: ref(false), dismiss: vi.fn(),
        sampleProject: onboarding.sampleProject, removingSample: ref(false), mark: vi.fn(), onAction: vi.fn(), removeSample: vi.fn()
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
        done: ref([]), doneLoaded: ref(true), delegated: ref([]), assignedCount: ref(0), mine: ref([]),
        openTasks: ref([...groups.today, ...groups.overdue, ...groups.next]),
        projectOf: () => null, setSort: vi.fn(), fetchOpen: vi.fn(() => Promise.resolve()), fetchDone: vi.fn()
    })
}));

import TodayOverdue from '@/views/Home/TodayOverdue.vue';
import { DEFAULT_HOME_LAYOUT, isHomeArranged, resetHomeCards } from '@/components/molecules/Home/homeCards';
import * as env from '@/config/env';

const NAMES = { waiting: 'WaitingOnYouCard', assigned_comments: 'AssignedCommentsCard', recents: 'RecentsCard', standup: 'StandupCard', goals: 'GoalsCard' };
const SAMPLE = { _id: 'p-sample', ProjectName: 'Sample', ProjectCode: 'SAMPLE' };
const task = (id, extra = {}) => ({ _id: id, TaskName: `Task ${id}`, ProjectID: 'p1', sprintId: 's1', ...extra });

let wrapper;
let approvalCount;

const openHome = async ({ stored, projects = [{ _id: 'p1', ProjectName: 'Launch' }] } = {}) => {
    resetHomeCards();
    getters['users/users'] = [{ _id: 'user-1', homeCards: stored }];
    getters['projectData/projects'] = { data: projects };
    getters['settings/selectedCompany'] = { Cst_CompanyName: 'Acme' };
    wrapper = mount(TodayOverdue, { attachTo: document.body, global: { stubs: { RouterLink: true }, provide: { $dateFormat: ref('') } } });
    await flushPromises();
    return wrapper;
};

const sideCards = () => [...wrapper.find('.home__side').element.children].map((el) => el.getAttribute('data-card')).filter((name) => name && name !== 'TimerChip');
const line = () => wrapper.find('[data-test="home-next"]');

beforeEach(() => {
    route.query = {};
    router.push.mockClear();
    Object.keys(perms).forEach((key) => delete perms[key]);
    onboarding.show.value = false;
    onboarding.sampleProject.value = null;
    groups.today = [];
    groups.overdue = [];
    groups.next = [];
    groups.unscheduled = [];
    approvalCount = 0;
    apiRequest.mockReset();
    apiRequest.mockImplementation((type, url) => Promise.resolve(url === `${env.INBOX}/counts`
        ? { data: { status: true, data: { approval: approvalCount } } }
        : { data: {} }));
});

afterEach(() => { wrapper?.unmount(); });

describe('whether a person has arranged Home', () => {
    it('is read from what is stored for them', () => {
        expect(isHomeArranged(undefined)).toBe(false);
        expect(isHomeArranged({})).toBe(false);
        expect(isHomeArranged({ hidden: [] })).toBe(false);
        expect(isHomeArranged({ hidden: ['recents'] })).toBe(true);
        expect(isHomeArranged({ layout: [] })).toBe(true);
        expect(isHomeArranged({ layout: ['recents', 'waiting'] })).toBe(true);
    });
});

describe('the order of Home', () => {
    it('a new account sees what needs approval before the agenda, then the other cards', async () => {
        await openHome();
        expect(sideCards()).toEqual(['WaitingOnYouCard', 'AgendaCard', ...DEFAULT_HOME_LAYOUT.filter((id) => id !== 'waiting').map((id) => NAMES[id])]);
    });

    it('an account that arranged Home keeps its order', async () => {
        await openHome({ stored: { layout: ['recents', 'waiting'] } });
        expect(sideCards()).toEqual(['AgendaCard', 'RecentsCard', 'WaitingOnYouCard']);
    });

    it('an arranged Home that starts with approvals is left as it was, below the agenda', async () => {
        await openHome({ stored: { layout: ['waiting', 'goals'] } });
        expect(sideCards()).toEqual(['AgendaCard', 'WaitingOnYouCard', 'GoalsCard']);
    });

    it('an account that hid approvals does not get the card back', async () => {
        await openHome({ stored: { hidden: ['waiting'] } });
        expect(sideCards()).toEqual(['AgendaCard', 'AssignedCommentsCard', 'RecentsCard', 'StandupCard']);
    });

    it('what next stands above today\'s work, for an arranged Home too', async () => {
        groups.today = [task('t1')];
        await openHome({ stored: { layout: ['recents'] } });
        const order = [...wrapper.find('.home__content').element.children].map((el) => el.getAttribute('data-test') || el.className);
        expect(order.indexOf('home-next')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('home-next')).toBeLessThan(order.indexOf('home__grid'));
    });
});

describe('what next on Home', () => {
    it('approvals waiting: the Inbox\'s count, and the button opens that tab', async () => {
        approvalCount = 2;
        groups.overdue = [task('t2')];
        await openHome();
        expect(line().attributes('data-kind')).toBe('approvals');
        expect(line().attributes('data-count')).toBe('2');
        await line().find('button').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'inbox', params: { cid: 'company-1' }, query: { tab: 'approval' } });
    });

    it('overdue work: the number My work lists, and the button takes the keyboard to those rows', async () => {
        groups.today = [task('t1')];
        groups.overdue = [task('t2'), task('t3')];
        await openHome();
        expect(line().attributes('data-kind')).toBe('overdue');
        expect(line().attributes('data-count')).toBe(wrapper.find('[data-test="mywork-overdue"] .hc-group__count').text());
        expect(line().attributes('data-count')).toBe('2');
        await line().find('button').trigger('click');
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.find('[data-test="mywork-overdue"]').element);
    });

    it('today\'s work: the button takes the keyboard to today\'s rows', async () => {
        groups.today = [task('t1')];
        await openHome();
        expect(line().attributes('data-kind')).toBe('today');
        expect(line().attributes('data-count')).toBe('1');
        await line().find('button').trigger('click');
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.find('[data-test="mywork-today"]').element);
    });

    it('nothing to do: says so and offers a task', async () => {
        await openHome();
        expect(line().attributes('data-kind')).toBe('clear');
        await line().find('button').trigger('click');
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.find('.hc-add input').element);
    });

    it('an empty workspace: one step, a project, and the button starts it', async () => {
        onboarding.sampleProject.value = SAMPLE;
        groups.next = [task('s1', { ProjectID: SAMPLE._id })];
        await openHome({ projects: [SAMPLE] });
        expect(line().attributes('data-kind')).toBe('start_project');
        expect(wrapper.find('[data-card="CreateProjectSidebar"]').exists()).toBe(false);
        await line().find('button').trigger('click');
        expect(wrapper.find('[data-card="CreateProjectSidebar"]').exists()).toBe(true);
    });

    it('an empty workspace for someone who may not create a project: a task of their own', async () => {
        perms['project.project_create'] = false;
        await openHome({ projects: [] });
        expect(line().attributes('data-kind')).toBe('start_task');
    });

    it('while the setup card is up it is the one next step, so the line stays out of its way', async () => {
        onboarding.show.value = true;
        await openHome({ projects: [] });
        expect(wrapper.find('[data-card="SetupChecklist"]').exists()).toBe(true);
        expect(line().exists()).toBe(false);
    });

    it('but work that waits is still said beside the setup card', async () => {
        onboarding.show.value = true;
        approvalCount = 1;
        await openHome({ projects: [] });
        expect(line().attributes('data-kind')).toBe('approvals');
    });
});
