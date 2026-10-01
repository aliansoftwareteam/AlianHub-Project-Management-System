/* Task 046 M3, slice G3: the Goals page. The store is the real one; `@/services` answers from the
   recorded server responses (tests/fixtures/goalResponses.json), as whoever the test says is
   looking. The page's English is the real one too, so what a person is told is what is checked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';
import fixture from '../fixtures/goalResponses.json';
import en from '@/locales/en';

const { apiRequest, route, router, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { value: null },
    router: { push: vi.fn(), replace: vi.fn(), hasRoute: () => true },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

const ME = '6f0000000000000000000001';
const SAM = '6f0000000000000000000002';
const ADA = '6f0000000000000000000003';
const GIL = '6f0000000000000000000004';
const GONE = '6f0000000000000000000005';
const REVENUE = '6f0000000000000000000e01';
const CHURN = '6f0000000000000000000e02';
const SECRET = '6f0000000000000000000e06';
const CREATED = fixture.created.response.data._id;
const NAMES = { [ME]: 'Me Myself', [SAM]: 'Sam Carter', [ADA]: 'Ada Admin', [GIL]: 'Gil Guest', [GONE]: 'gone@example.com' };
const GOALS = '/api/v2/goals';

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route.value, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: NAMES[id] || 'Ghost User', Employee_profileImageURL: '' }) })
}));

import goals from '@/store/Goals';
import { REFETCH_DELAY_MS } from '@/store/Goals';
import Goals from '@/views/Goals/Goals.vue';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let viewer = 'me';
const recordedAs = (method, url, body) => Object.keys(fixture).find((name) => {
    const { as, request } = fixture[name];
    return as === viewer && request.method === method && request.path === url && same(request.body, body);
});
const answer = (method, url, body) => {
    const name = recordedAs(method, url, body);
    if (!name) return Promise.reject(new Error(`a request the server never recorded: ${method} ${url} ${JSON.stringify(body)}`));
    const { statusCode, response } = fixture[name];
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
};
const sentNames = () => apiRequest.mock.calls.map(([method, url, body]) => recordedAs(method, url, body));
const once = (name) => apiRequest.mockImplementationOnce(() => {
    const { statusCode, response } = fixture[name];
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
});
const listOf = (...list) => apiRequest.mockImplementationOnce(() => Promise.resolve({ data: { status: true, statusText: 'Goals fetched successfully.', data: list } }));

const SEATS = [
    { userId: ME, roleType: 3, status: 2 },
    { userId: SAM, roleType: 3, status: 2 },
    { userId: ADA, roleType: 2, status: 2 },
    { userId: GIL, roleType: 0, status: 2 },
    { userId: GONE, roleType: 3, status: 2, isDelete: true },
    { userId: '6f0000000000000000000006', roleType: 3, status: 1 }
];
const socket = { id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() };

const newStore = ({ roleType = 3, currencies = ['USD', 'EUR', 'GBP'] } = {}) => createStore({
    modules: {
        goals,
        settings: {
            namespaced: true,
            getters: {
                companyUsers: () => SEATS,
                companyUserDetail: () => ({ roleType }),
                allCurrencyArray: () => currencies.map((code) => ({ code, name: `${code} money`, symbol: code })),
                getSocketInstance: () => socket
            }
        }
    }
});

let wrapper;
let store;
const open = async ({ as = 'me', roleType = 3, goalId = '', userId = ME } = {}) => {
    viewer = as;
    route.value = reactive({ name: goalId ? 'Goal' : 'Goals', params: goalId ? { cid: 'company-1', goalId } : { cid: 'company-1' } });
    store = newStore({ roleType });
    wrapper = mount(Goals, { global: { plugins: [store], provide: { $userId: ref(userId) } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const at = (name, root = wrapper) => root.find(`[data-test="${name}"]`);
const all = (name, root = wrapper) => root.findAll(`[data-test="${name}"]`);
const rows = () => all('gls-row');
const rowOf = (name) => rows().find((row) => row.find('.gls__name').text() === name);
const groups = () => wrapper.findAll('[data-group]').map((group) => [group.attributes('data-group'), group.findAll('.gls__name').map((name) => name.text())]);
const panel = () => at('glp');
const targets = () => all('glt');
const targetOf = (name) => targets().find((target) => target.find('.glt__name').text() === name);
const errorFor = (field, root = wrapper) => root.find(`[data-error-for="${field}"]`);
const openGoal = async (name) => {
    await rowOf(name).trigger('click');
    await flushPromises();
};
const setValue = async (input, value) => {
    await input.setValue(value);
    await flushPromises();
};

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 15, 10, 0) });
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    router.push.mockReset();
    router.push.mockImplementation(({ name, params }) => { Object.assign(route.value, { name, params }); return Promise.resolve(); });
    Object.values(toast).forEach((spy) => spy.mockReset());
    Object.values(socket).forEach((spy) => typeof spy === 'function' && spy.mockReset());
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('the list', () => {
    it('shows a skeleton while it loads, then the goals grouped by period: current, upcoming, past, no dates', async () => {
        let arrive;
        apiRequest.mockImplementationOnce(() => new Promise((resolve) => { arrive = resolve; }));
        await open();
        expect(at('gls-loading').exists()).toBe(true);
        expect(rows()).toHaveLength(0);

        arrive({ data: fixture.list.response });
        await flushPromises();
        expect(at('gls-loading').exists()).toBe(false);
        expect(groups()).toEqual([
            ['current', ['Grow revenue']],
            ['upcoming', ['Cut churn']],
            ['past', ['Hire the team']],
            ['none', ['Refresh the brand']]
        ]);
        expect(wrapper.findAll('[data-group] h2').map((heading) => heading.text())).toEqual(['Current', 'Upcoming', 'Past', 'No dates']);
    });

    it('says on each goal who owns it, who sees it, when it runs, how far it is and how many targets are reached', async () => {
        await open();
        const revenue = rowOf('Grow revenue');
        expect(revenue.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('33');
        expect(revenue.find('.gls__pct').text()).toBe('33%');
        expect(at('gls-reached', revenue).text()).toBe('1 of 3 targets reached');
        expect(revenue.find('.gls__period').text()).toBe('Oct 1, 2026 to Dec 31, 2026');
        expect(at('gls-owner', revenue).attributes('title')).toBe('Owned by Me Myself');
        expect(at('gls-vis', revenue).attributes('data-visibility')).toBe('workspace');

        expect(at('gls-vis', rowOf('Cut churn')).attributes()).toMatchObject({ 'data-visibility': 'private', title: 'Private' });
        expect(at('gls-vis', rowOf('Hire the team')).attributes()).toMatchObject({ 'data-visibility': 'people', title: 'Shared with you' });
        expect(at('gls-owner', rowOf('Hire the team')).attributes('title')).toBe('Owned by Sam Carter');
        expect(at('gls-reached', rowOf('Refresh the brand')).text()).toBe('No targets yet');
        expect(rowOf('Refresh the brand').find('.gls__period').text()).toBe('No dates');
    });

    it('filters to mine, and to the archived goals', async () => {
        await open();
        await at('gls-scope-mine').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('listMine');
        expect(at('gls-scope-mine').attributes('aria-pressed')).toBe('true');
        expect(rows()).toHaveLength(3);

        await at('gls-scope-all').trigger('click');
        await at('gls-archived').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('listArchived');
        expect(at('gls-archived').attributes('aria-pressed')).toBe('true');
        expect(rows().map((row) => row.find('.gls__name').text())).toEqual(['Launch v1']);
    });

    it('sorts by name as the server sent them, or by progress', async () => {
        listOf(
            { ...fixture.list.response.data[1], _id: 'a', name: 'Alpha', progressPct: 10 },
            { ...fixture.list.response.data[1], _id: 'b', name: 'Beta', progressPct: 90 }
        );
        await open();
        expect(groups()).toEqual([['current', ['Alpha', 'Beta']]]);
        await at('gls-sort').setValue('progress');
        expect(groups()).toEqual([['current', ['Beta', 'Alpha']]]);
    });

    it('says so when there are none, and offers to make one', async () => {
        listOf();
        await open();
        expect(at('gls-empty').text()).toContain('No goals yet');
        expect(at('gls-empty-new').exists()).toBe(true);
        expect(at('gls-error').exists()).toBe(false);
    });

    it('says the load failed, and loads again on retry', async () => {
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
        await open();
        expect(at('gls-error').attributes('role')).toBe('alert');
        await at('gls-retry').trigger('click');
        await flushPromises();
        expect(rows()).toHaveLength(4);
    });
});

describe('a guest', () => {
    it('sees what is shared with them, and nothing to make a goal with', async () => {
        await open({ as: 'gil', roleType: 0, userId: GIL });
        expect(rows().map((row) => row.find('.gls__name').text())).toEqual(['Client rollout']);
        expect(at('gls-new').exists()).toBe(false);
    });

    it('with nothing shared sees an empty state, not an error, and still no "New goal"', async () => {
        listOf();
        await open({ as: 'gil', roleType: 0, userId: GIL });
        expect(at('gls-empty').text()).toContain('No goals are shared with you');
        expect(at('gls-empty-new').exists()).toBe(false);
        expect(at('gls-new').exists()).toBe(false);
        expect(at('gls-error').exists()).toBe(false);
    });
});

describe('opening a goal', () => {
    it('puts it in the address, shows its panel beside the list, and gives the row its focus back on close', async () => {
        await open();
        expect(panel().exists()).toBe(false);
        await openGoal('Grow revenue');
        expect(router.push).toHaveBeenLastCalledWith({ name: 'Goal', params: { cid: 'company-1', goalId: REVENUE } });
        expect(panel().exists()).toBe(true);
        expect(panel().element.contains(document.activeElement)).toBe(true);
        expect(rows()).toHaveLength(4);
        rows().forEach((row) => expect(row.element.tagName).toBe('BUTTON'));
        expect(at('glp-name').element.value).toBe('Grow revenue');
        expect(rowOf('Grow revenue').attributes('aria-current')).toBe('true');

        await at('glp-close').trigger('click');
        await flushPromises();
        expect(router.push).toHaveBeenLastCalledWith({ name: 'Goals', params: { cid: 'company-1' } });
        expect(panel().exists()).toBe(false);
        expect(document.activeElement).toBe(rowOf('Grow revenue').element);
    });

    it('closes on Escape', async () => {
        await open();
        await openGoal('Grow revenue');
        await panel().trigger('keydown', { key: 'Escape' });
        await flushPromises();
        expect(panel().exists()).toBe(false);
        expect(document.activeElement).toBe(rowOf('Grow revenue').element);
    });

    it('opens straight from a link, also for a goal the list does not hold', async () => {
        await open({ goalId: CREATED });
        expect(sentNames()).toContain('readArchived');
        expect(at('glp-archived').exists()).toBe(true);
        expect(panel().text()).toContain('Ship the mobile app');
    });

    it('says a goal that is not theirs to read is not available', async () => {
        await open({ goalId: SECRET });
        expect(at('glp-missing').text()).toContain('This goal is not available');
        expect(at('glp-name').exists()).toBe(false);
    });
});

describe('a reader who may not edit', () => {
    beforeEach(async () => {
        await open();
        await openGoal('Hire the team');
    });

    it('reads the goal and its targets', () => {
        expect(at('glp-name-text').text()).toBe('Hire the team');
        expect(at('glp-vis-text').text()).toBe('Shared with you');
        expect(targets().map((target) => target.find('.glt__name').text())).toEqual(['Offer accepted', 'Engineers']);
        expect(targetOf('Offer accepted').text()).toContain('Not done');
        expect(at('glt-reached', targetOf('Engineers')).exists()).toBe(true);
    });

    it('is offered nothing they cannot use', () => {
        ['glp-name', 'glp-description', 'glp-start', 'glp-end', 'glp-vis-private', 'glp-color', 'glp-owner-change', 'glp-archive', 'glp-restore', 'glp-add-target',
            'glt-done', 'glt-value', 'glt-edit', 'glt-remove'].forEach((name) => expect({ name, shown: at(name).exists() }).toEqual({ name, shown: false }));
        expect(panel().findAll('input, select, textarea')).toHaveLength(0);
    });
});

describe('an editor', () => {
    it('renames in place, and a name the page would not send is said under the field', async () => {
        await open();
        await openGoal('Grow revenue');
        const sent = apiRequest.mock.calls.length;
        await setValue(at('glp-name'), '   ');
        await at('glp-name').trigger('blur');
        await flushPromises();
        expect(errorFor('name', panel()).text()).toBe('Give it a name of up to 120 characters.');
        expect(at('glp-name').attributes('aria-invalid')).toBe('true');
        expect(apiRequest).toHaveBeenCalledTimes(sent);
    });

    it('changes the description in place', async () => {
        await open();
        await openGoal('Grow revenue');
        await setValue(at('glp-description'), 'Net new revenue, all regions');
        await at('glp-description').trigger('blur');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('described');
        expect(at('glp-description').element.value).toBe('Net new revenue, all regions');
    });

    it('is told who will see the goal before it is saved, and picks the people from the active members', async () => {
        await open();
        await openGoal('Cut churn');
        expect(at('glp-vis-private').element.checked).toBe(true);
        expect(at('glp-vis-effect').text()).toBe('Only you');
        expect(all('glp-person')).toHaveLength(0);

        await at('glp-vis-workspace').setValue(true);
        expect(at('glp-vis-effect').text()).toBe('Everyone in the workspace');

        await at('glp-vis-people').setValue(true);
        expect(at('glp-vis-effect').text()).toBe('Only you, until you pick someone');
        const people = all('glp-person');
        expect(people.map((person) => person.find('.gpp__name').text())).toEqual(['Ada Admin', 'Gil Guest', 'Sam Carter']);
        expect(people.map((person) => person.find('.ah-chip').exists())).toEqual([false, true, false]);

        await people[2].find('input').setValue(true);
        expect(at('glp-vis-effect').text()).toBe('You and 1 person');
        await people[1].find('input').setValue(true);
        expect(at('glp-vis-effect').text()).toBe('You and 2 people');

        await at('glp-vis-save').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('shared');
        expect(at('glp-vis-save').exists()).toBe(false);
        expect(at('gls-vis', rowOf('Cut churn')).attributes('data-visibility')).toBe('people');
    });

    it('sees a person the server no longer accepts named on the picker', async () => {
        await open();
        await openGoal('Cut churn');
        await at('glp-vis-people').setValue(true);
        await all('glp-person')[2].find('input').setValue(true);
        once('sharedRefused');
        await at('glp-vis-save').trigger('click');
        await flushPromises();
        expect(errorFor('sharedWith', panel()).text()).toContain('no longer an active member');
        expect(at('glp-vis-save').exists()).toBe(true);
    });

    it('is told what handing the goal over costs them, before it is done', async () => {
        await open();
        await openGoal('Grow revenue');
        await at('glp-owner-change').trigger('click');
        const options = at('glp-owner-pick').findAll('option').map((option) => option.text());
        expect(options).toEqual(['Choose a person', 'Ada Admin', 'Sam Carter']);
        await at('glp-owner-pick').setValue(SAM);
        expect(at('glp-owner-effect').text()).toBe('Make Sam Carter the owner? You will no longer be able to edit this goal.');
        await at('glp-owner-cancel').trigger('click');
        expect(at('glp-owner-pick').exists()).toBe(false);
        expect(sentNames()).toEqual(['list']);
    });
});

describe('a new goal', () => {
    const create = async () => {
        await at('gls-new').trigger('click');
        await setValue(at('gls-create-name'), '  Ship the mobile app ');
        await setValue(at('gls-create-start'), '2026-10-01');
        await setValue(at('gls-create-end'), '2026-12-31');
        await at('gls-create').trigger('submit');
        await flushPromises();
    };

    it('is made from a name and a period, starts private, and opens', async () => {
        await open();
        await at('gls-new').trigger('click');
        expect(document.activeElement).toBe(at('gls-create-name').element);
        expect(at('gls-create').text()).toContain('Only you');
        await at('gls-create-cancel').trigger('click');
        expect(at('gls-create').exists()).toBe(false);

        await create();
        expect(sentNames().at(-1)).toBe('created');
        expect(router.push).toHaveBeenLastCalledWith({ name: 'Goal', params: { cid: 'company-1', goalId: CREATED } });
        expect(at('gls-create').exists()).toBe(false);
        expect(at('glp-name').element.value).toBe('Ship the mobile app');
        expect(at('glp-add-target').exists()).toBe(true);
    });

    it('is not sent with an end before its start: the end field says why', async () => {
        await open();
        await at('gls-new').trigger('click');
        await setValue(at('gls-create-name'), 'Backwards');
        await setValue(at('gls-create-start'), '2026-12-31');
        await setValue(at('gls-create-end'), '2026-10-01');
        await at('gls-create').trigger('submit');
        await flushPromises();
        expect(errorFor('periodEnd', at('gls-create')).text()).toBe('The end cannot be before the start.');
        expect(at('gls-create-end').attributes('aria-invalid')).toBe('true');
        expect(sentNames()).toEqual(['list']);
    });

    it('leaves the list when it is handed to someone else, and the person is told it will', async () => {
        await open();
        await create();
        await at('glp-owner-change').trigger('click');
        await at('glp-owner-pick').setValue(SAM);
        expect(at('glp-owner-effect').text()).toBe('Make Sam Carter the owner? You will no longer see this goal.');
        await at('glp-owner-confirm').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('handedOver');
        expect(panel().exists()).toBe(false);
        expect(router.push).toHaveBeenLastCalledWith({ name: 'Goals', params: { cid: 'company-1' } });
        expect(rows()).toHaveLength(4);
        expect(at('gls-error').exists()).toBe(false);
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledWith('The goal is no longer in your list.', expect.anything());
    });

    it('is archived and restored from its panel, and cannot be changed in between', async () => {
        await open();
        await create();
        await at('glp-archive').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('archived');
        expect(at('glp-archived').text()).toContain('This goal is archived. Restore it to change it.');
        expect(at('glp-name').exists()).toBe(false);
        expect(at('glp-add-target').exists()).toBe(false);
        expect(rows()).toHaveLength(4);

        await at('glp-restore').trigger('click');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('restored');
        expect(at('glp-name').exists()).toBe(true);
        expect(rows()).toHaveLength(5);
    });
});

describe('targets', () => {
    beforeEach(async () => {
        await open();
        await openGoal('Grow revenue');
    });

    it('show each kind in its own way, with its progress, weight and who updated it', () => {
        expect(targets().map((target) => target.attributes('data-kind'))).toEqual(['number', 'currency', 'boolean']);

        const customers = targetOf('New customers');
        expect(at('glt-value', customers).element.value).toBe('3');
        expect(customers.find('.glt__range').text()).toBe('from 0 customers to 10 customers');
        expect(customers.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('30');
        expect(customers.find('.glt__weight').text()).toBe('Weight 1');
        expect(customers.find('.glt__updated').text()).toContain('Updated by Me Myself');

        const revenue = targetOf('Revenue');
        expect(revenue.find('.glt__range').text()).toBe('from $1,000 to $5,000');
        expect(revenue.find('.glt__weight').text()).toBe('Weight 2');

        const pricing = targetOf('Pricing page live');
        expect(at('glt-done', pricing).element.checked).toBe(true);
        expect(at('glt-reached', pricing).text()).toBe('Reached');
        expect(at('glt-reached', customers).exists()).toBe(false);
    });

    it('read a target that runs downwards the right way round', async () => {
        await openGoal('Cut churn');
        expect(targetOf('Monthly churn').find('.glt__range').text()).toBe('from 40 % down to 10 %');
        expect(targetOf('Monthly churn').find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
    });

    it('take a new number with Enter', async () => {
        const input = at('glt-value', targetOf('New customers'));
        await setValue(input, '5');
        await input.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(sentNames().at(-1)).toBe('valueSet');
        expect(targetOf('New customers').find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
        expect(rowOf('Grow revenue').find('.gls__pct').text()).toBe('38%');
    });

    it('take true or false with one click', async () => {
        await at('glt-done', targetOf('Pricing page live')).setValue(false);
        await flushPromises();
        expect(sentNames().at(-1)).toBe('valueUnticked');
        expect(at('glt-reached', targetOf('Pricing page live')).exists()).toBe(false);
    });

    it('put a value the server refuses back, and say why under the field', async () => {
        const input = at('glt-value', targetOf('New customers'));
        await setValue(input, '1e16');
        await input.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(sentNames().at(-1)).toBe('valueTooLarge');
        expect(errorFor('current', targetOf('New customers')).text()).toBe('Enter a number.');
        expect(targetOf('New customers').find('[role="progressbar"]').attributes('aria-valuenow')).toBe('30');
    });

    it('are added with a form for their kind', async () => {
        await openGoal('Cut churn');
        await at('glp-add-target').trigger('click');
        const form = () => at('gtf');
        expect(at('gtf-kind', form()).findAll('option').map((option) => option.text())).toEqual(['Number', 'Currency', 'True or false', 'Counted from tasks']);
        expect(at('gtf-currency', form()).exists()).toBe(false);

        await at('gtf-kind', form()).setValue('boolean');
        ['gtf-start', 'gtf-target', 'gtf-unit', 'gtf-currency'].forEach((name) => expect(at(name, form()).exists()).toBe(false));

        await at('gtf-kind', form()).setValue('currency');
        expect(at('gtf-currency', form()).findAll('option').map((option) => option.element.value)).toEqual(['', 'EUR', 'GBP', 'USD']);
        await setValue(at('gtf-name', form()), 'Revenue kept');
        await setValue(at('gtf-start', form()), '0');
        await setValue(at('gtf-target', form()), '20000');
        await setValue(at('gtf-currency', form()), 'EUR');
        await setValue(at('gtf-weight', form()), '2');
        await form().trigger('submit');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('targetAdded');
        expect(form().exists()).toBe(false);
        expect(targets().map((target) => target.find('.glt__name').text())).toEqual(['Monthly churn', 'Revenue kept']);
    });

    it('land a refusal from the server on the field it names', async () => {
        await openGoal('Cut churn');
        await at('glp-add-target').trigger('click');
        await at('gtf-kind').setValue('currency');
        await setValue(at('gtf-name'), 'In pounds');
        await setValue(at('gtf-target'), '100');
        await setValue(at('gtf-currency'), 'GBP');
        await at('gtf').trigger('submit');
        await flushPromises();
        expect(sentNames().at(-1)).toBe('targetAddRefused');
        expect(errorFor('currencyCode', at('gtf')).text()).toBe('Choose one of the workspace\'s currencies.');
        expect(at('gtf-currency').attributes('aria-invalid')).toBe('true');
        expect(at('gtf-name').attributes('aria-invalid')).toBeUndefined();
        expect(at('gtf-name').element.value).toBe('In pounds');
    });

    it('say what is missing before anything is sent', async () => {
        await at('glp-add-target').trigger('click');
        await at('gtf').trigger('submit');
        await flushPromises();
        expect(errorFor('name', at('gtf')).text()).toBe('Give it a name of up to 120 characters.');
        expect(errorFor('target', at('gtf')).text()).toBe('Enter the target.');
        expect(sentNames()).toEqual(['list']);
    });

    it('are edited without their kind, and removed after a confirm', async () => {
        await openGoal('Cut churn');
        await at('glt-edit', targetOf('Monthly churn')).trigger('click');
        expect(at('gtf-kind').exists()).toBe(false);
        expect(at('gtf').text()).toContain('A target\'s kind cannot be changed.');
        expect(at('gtf-start').element.value).toBe('40');
        await setValue(at('gtf-name'), 'Monthly churn rate');
        await setValue(at('gtf-target'), '5');
        once('targetEdited');
        await at('gtf').trigger('submit');
        await flushPromises();
        expect(apiRequest.mock.calls.at(-1)).toEqual(['patch', fixture.targetEdited.request.path, { name: 'Monthly churn rate', target: 5 }]);

        const saved = targetOf('Monthly churn rate');
        await at('glt-remove', saved).trigger('click');
        expect(apiRequest.mock.calls.at(-1)[0]).toBe('patch');
        expect(saved.text()).toContain('Remove this target? Its value is lost.');
        once('targetRemoved');
        await at('glt-remove-confirm', saved).trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.at(-1).slice(0, 2)).toEqual(['delete', `${GOALS}/${CHURN}/targets/${fixture.targetEdited.response.data.targets[0].id}`]);
    });
});

describe('a kind of target this build does not know', () => {
    it('is shown with its progress and nothing to press, beside the ones it does know', async () => {
        const [, revenue] = fixture.list.response.data;
        const scored = { id: '6f0000000000000000000f99', name: 'Launch score', kind: 'formula', weight: 3, progressPct: 40, reachedAt: null, updatedBy: '', updatedAt: null };
        listOf({ ...revenue, targets: [...revenue.targets, scored] });
        await open();
        await openGoal('Grow revenue');

        const unknown = targetOf('Launch score');
        expect(unknown.attributes('data-kind')).toBe('formula');
        expect(unknown.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('40');
        expect(unknown.find('.glt__weight').text()).toBe('Weight 3');
        expect(unknown.findAll('input, button, select')).toHaveLength(0);
        expect(targets()).toHaveLength(4);
        expect(at('glt-value', targetOf('New customers')).exists()).toBe(true);
    });
});

describe('an owner or admin', () => {
    it('edits a workspace goal that is someone else\'s, and keeps the right after handing it on', async () => {
        await open({ as: 'ada', roleType: 2, userId: ADA });
        await openGoal('Refresh the brand');
        expect(at('glp-name').exists()).toBe(true);
        await at('glp-owner-change').trigger('click');
        await at('glp-owner-pick').setValue(ME);
        expect(at('glp-owner-effect').text()).toBe('Make Me Myself the owner? You can still edit this goal.');
    });
});

describe('a change made by someone else', () => {
    it('is listened for while the page is open, and read once after the changes stop', async () => {
        await open();
        expect(socket.on).toHaveBeenCalledWith('goalsChanged', expect.any(Function));
        const [, changed] = socket.on.mock.calls.find(([event]) => event === 'goalsChanged');

        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date(2026, 9, 15, 10, 0) });
        changed({ type: 'update' });
        changed({ type: 'update' });
        expect(apiRequest).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(REFETCH_DELAY_MS);
        expect(sentNames()).toEqual(['list', 'list']);
        vi.useRealTimers();
        await flushPromises();
        expect(at('gls-loading').exists()).toBe(false);

        wrapper.unmount();
        wrapper = null;
        expect(socket.off).toHaveBeenCalledWith('goalsChanged', changed);
    });
});
