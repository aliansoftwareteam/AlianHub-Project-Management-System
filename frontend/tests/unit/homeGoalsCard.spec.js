/* Task 046 M3, slice G5: the Goals card on Home. It asks the goals list for the person's own goals
   (the server decides which those are), shows five, and links to each goal and to the Goals page. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const { apiRequest, apiRequestWithoutCompnay, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    router: { push: vi.fn(() => Promise.resolve()), replace: vi.fn(), hasRoute: () => true }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => ({ name: 'Home', params: {}, query: {} }) }));

import GoalsCard from '@/components/molecules/Home/GoalsCard.vue';
import { DEFAULT_HOME_LAYOUT, HOME_CARDS, homeCardInfo, resolveHomeLayout } from '@/components/molecules/Home/homeCards';

const CID = 'company-1';
const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' };
const goal = (n, over = {}) => ({ _id: `goal-${n}`, name: `Goal ${n}`, progressPct: n * 10, periodStart: '', periodEnd: '', targets: [], ...over });

let wrapper;
const show = async ({ goals = [], roleType = 3, fails = false } = {}) => {
    apiRequest.mockImplementation(() => (fails ? Promise.reject(new Error('offline')) : Promise.resolve({ data: { status: true, data: goals } })));
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } }, brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } } } });
    wrapper = mount(GoalsCard, { global: { plugins: [store], provide: { $companyId: ref(CID) }, stubs: { RouterLink } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const at = (name) => wrapper.find(`[data-test="${name}"]`);
const rows = () => wrapper.findAll('[data-test="goals-card-row"]');
const toOf = (link) => JSON.parse(link.attributes('data-to'));

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 15, 10, 0) });
    apiRequest.mockReset();
    router.push.mockClear();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('the Goals card on Home', () => {
    it('asks for the goals the person owns or is named on, and for nothing else', async () => {
        await show({ goals: [goal(1)] });
        expect(apiRequest.mock.calls).toEqual([['get', '/api/v2/goals?mine=true']]);
    });

    it('shows each goal with its progress and when it ends, linked to the goal', async () => {
        await show({ goals: [goal(4, { name: 'Grow revenue', progressPct: 33, periodStart: '2026-10-01', periodEnd: '2026-12-31' }), goal(2, { name: 'No dates' })] });
        const [first, second] = rows();
        expect(first.find('.hgl__name').text()).toBe('Grow revenue');
        expect(first.find('.hgl__pct').text()).toBe('33%');
        expect(first.find('[role="progressbar"]').attributes()).toMatchObject({ 'aria-valuenow': '33', 'aria-label': 'Progress of Grow revenue' });
        expect(first.find('.hgl__end').text()).toBe(`Until ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(2026, 11, 31))}`);
        expect(toOf(first)).toEqual({ name: 'Goal', params: { cid: CID, goalId: 'goal-4' } });
        expect(second.find('.hgl__end').exists()).toBe(false);
        expect(toOf(second)).toEqual({ name: 'Goal', params: { cid: CID, goalId: 'goal-2' } });
    });

    it('links to the Goals page', async () => {
        await show({ goals: [goal(1)] });
        expect(toOf(at('goals-card-all'))).toEqual({ name: 'Goals', params: { cid: CID } });
        expect(at('goals-card-all').text()).toBe('All goals');
    });

    it('shows five at most, the goals of the period under way first', async () => {
        const past = goal(1, { name: 'Past', periodStart: '2026-01-01', periodEnd: '2026-03-31' });
        const current = [2, 3, 4, 5].map((n) => goal(n, { name: `Current ${n}`, periodStart: '2026-10-01', periodEnd: '2026-12-31' }));
        const upcoming = [6, 7].map((n) => goal(n, { name: `Upcoming ${n}`, periodStart: '2027-01-01', periodEnd: '2027-03-31' }));
        await show({ goals: [past, ...upcoming, ...current] });
        expect(rows().map((row) => row.find('.hgl__name').text())).toEqual(['Current 2', 'Current 3', 'Current 4', 'Current 5', 'Upcoming 6']);
    });

    it('says so when there is none, and offers a new goal to someone who may make one', async () => {
        await show();
        expect(rows()).toHaveLength(0);
        expect(at('goals-card-empty').text()).toContain('No goals of yours yet');
        await at('goals-card-empty').find('button').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'Goals', params: { cid: CID }, query: { new: '1' } });
        expect(toOf(at('goals-card-all'))).toEqual({ name: 'Goals', params: { cid: CID } });
    });

    it('offers a guest nothing to make', async () => {
        await show({ roleType: 0 });
        expect(at('goals-card-empty').text()).toContain('No goals have been shared with you yet.');
        expect(at('goals-card-empty').find('button').exists()).toBe(false);
    });

    it('says the goals could not be loaded, and reads them again when asked', async () => {
        await show({ fails: true });
        expect(at('goals-card-failed').text()).toContain('Your goals could not be loaded.');
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: [goal(1)] } }));
        await at('goals-card-failed').find('button').trigger('click');
        await flushPromises();
        expect(rows()).toHaveLength(1);
    });

    it('asks to be hidden from its own button', async () => {
        await show({ goals: [goal(1)] });
        await at('goals-card-hide').trigger('click');
        expect(wrapper.emitted('hide')).toHaveLength(1);
        expect(at('goals-card-hide').attributes('aria-label')).toBe('Hide this card');
    });
});

describe('the Goals card in the Home card registry', () => {
    it('is a card of Home\'s own, offered in Manage cards', () => {
        expect(HOME_CARDS.map((card) => card.id)).toContain('goals');
        expect(homeCardInfo('goals')).toMatchObject({ id: 'goals', kind: 'home', labelKey: 'Home.card_goals', hintKey: 'Home.card_goals_hint' });
        expect(en.Home.card_goals).toBe('Goals');
    });

    it('is off until the person adds it: not among the default cards, and not on a Home arranged without it', () => {
        expect(DEFAULT_HOME_LAYOUT).not.toContain('goals');
        expect(resolveHomeLayout(undefined)).not.toContain('goals');
        expect(resolveHomeLayout({ hidden: ['standup'] })).not.toContain('goals');
        expect(resolveHomeLayout({ layout: ['recents', 'waiting'] })).toEqual(['recents', 'waiting']);
    });

    it('is on a Home whose saved layout names it', () => {
        expect(resolveHomeLayout({ layout: ['goals', 'recents'] })).toEqual(['goals', 'recents']);
    });
});
