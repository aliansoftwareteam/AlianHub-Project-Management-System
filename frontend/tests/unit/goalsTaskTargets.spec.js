/* Task 046 M3, slice G4: a target counted from tasks, on the Goals page. The goals store is the real
   one and the server's answers are the recorded ones (tests/fixtures/goalResponses.json), each given
   to the request the page really sends. The lists come from a project store shaped like the app's;
   the task search and the read of tasks by id belong to other modules and are answered here. */
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
const NAMES = { [ME]: 'Me Myself', [SAM]: 'Sam Carter' };
const WEBSITE = '6f0000000000000000000a01';
const HIRING_PLAN = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';
const BACKLOG = '6f0000000000000000000b02';
const TEAM_LIST = '6f0000000000000000000b03';
const NO_LIST = '6f0000000000000000000b09';
const LOOSE_TASK = '6f0000000000000000000d05';
const DELIVERY = fixture.tasksGoal.response.data._id;
const GOALS = '/api/v2/goals';
const SEARCH = '/api/v2/search';
const FIND = '/api/v1/task/find';

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route.value, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: NAMES[id] || 'Ghost User', Employee_profileImageURL: '' }) })
}));

import goals, { COUNT_POLL_LIMIT, COUNT_POLL_MS, REFETCH_DELAY_MS } from '@/store/Goals';
import Goals from '@/views/Goals/Goals.vue';
import GoalSourcePicker from '@/views/Goals/GoalSourcePicker.vue';

const PROJECTS = [
    {
        _id: WEBSITE, ProjectName: 'Website', statusType: 'active',
        sprintsObj: { [SPRINT]: { _id: SPRINT, name: 'Sprint 1' }, [BACKLOG]: { _id: BACKLOG, name: 'Backlog' }, [NO_LIST]: { _id: NO_LIST, name: 'Old sprint' } },
        sprintsfolders: {}
    },
    {
        _id: HIRING_PLAN, ProjectName: 'Hiring plan', statusType: 'active',
        sprintsObj: {},
        sprintsfolders: { f1: { name: 'Autumn', sprintsObj: { [TEAM_LIST]: { _id: TEAM_LIST, name: 'Interviews' } } } }
    }
];
const FOOTER = { _id: LOOSE_TASK, TaskName: 'Fix the footer', TaskKey: 'WEB-5', ProjectID: WEBSITE, sprintId: BACKLOG };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let viewer = 'me';
let tasks = [FOOTER];
let answered = [];
/* The server answered one request twice, differently, as the goal changed between: the recording is
   replayed in its order, each answer given once. */
const recordedAs = (method, url, body) => Object.keys(fixture).find((name) => {
    const { as, request } = fixture[name];
    return !answered.includes(name) && as === viewer && request.method === method && request.path === url && same(request.body, body);
});
const reply = (name) => {
    const { statusCode, response } = fixture[name];
    answered.push(name);
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
};
const answer = (method, url, body) => {
    if (url === SEARCH) return Promise.resolve({ data: { status: true, data: { tasks: tasks.filter((task) => task.TaskName.toLowerCase().includes(body.query.toLowerCase())) } } });
    if (url === FIND) return Promise.resolve({ status: 200, data: tasks.filter((task) => body.findQuery[0].$match._id.objId.$in.includes(task._id)) });
    const name = recordedAs(method, url, body);
    return name ? reply(name) : Promise.reject(new Error(`a request the server never recorded: ${method} ${url} ${JSON.stringify(body)}`));
};
const goalCalls = () => apiRequest.mock.calls.filter(([, url]) => url.startsWith(GOALS));
const sentNames = () => [...answered];
const once = (name) => apiRequest.mockImplementationOnce(() => reply(name));
const listOf = (...list) => apiRequest.mockImplementationOnce(() => Promise.resolve({ data: { status: true, statusText: 'Goals fetched successfully.', data: list } }));

const socket = { id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const newStore = (projects = PROJECTS) => createStore({
    modules: {
        goals,
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: projects }) } },
        settings: {
            namespaced: true,
            getters: {
                companyUsers: () => [{ userId: ME, roleType: 3, status: 2 }, { userId: SAM, roleType: 3, status: 2 }],
                companyUserDetail: () => ({ roleType: 3 }),
                allCurrencyArray: () => [],
                getSocketInstance: () => socket
            }
        }
    }
});

let wrapper;
let store;
/* The goal is read before the list is: `from` is the recorded answer the panel opens on. */
const open = async (from, { as = 'me', projects = PROJECTS } = {}) => {
    viewer = as;
    route.value = reactive({ name: 'Goal', params: { cid: 'company-1', goalId: DELIVERY } });
    store = newStore(projects);
    if (from) {
        once(from);
        listOf();
    }
    wrapper = mount(Goals, { global: { plugins: [store], provide: { $userId: ref(as === 'me' ? ME : SAM) } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const at = (name, root = wrapper) => root.find(`[data-test="${name}"]`);
const all = (name, root = wrapper) => root.findAll(`[data-test="${name}"]`);
const targetOf = (name) => all('glt').find((target) => target.find('.glt__name').exists() && target.find('.glt__name').text() === name);
const projectOf = (chip) => (chip.find('.gsc__project').exists() ? chip.find('.gsc__project').text() : '');
const chipsOf = (root) => all('gsc-chip', root).map((chip) => [chip.find('.gsc__name').text(), projectOf(chip)]);
const chipOf = (name, root = wrapper) => all('gsc-chip', root).find((chip) => chip.find('.gsc__name').text() === name);
const refusedChips = (root = wrapper) => all('gsc-chip', root).filter((chip) => chip.attributes('data-refused') === 'true').map((chip) => chip.find('.gsc__name').text());
const errorFor = (field, root = wrapper) => root.find(`[data-error-for="${field}"]`);
const click = async (found) => {
    await found.trigger('click');
    await flushPromises();
};
const pickList = (name) => click(all('gsp-list').find((option) => option.text().includes(name)));
const pickTask = async (needle, name) => {
    await at('gsp-search').setValue(needle);
    await vi.waitFor(() => expect(all('gsp-task').some((option) => option.text().includes(name))).toBe(true));
    await click(all('gsp-task').find((option) => option.text().includes(name)));
};
const fakeTimeouts = () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date(2026, 9, 15, 10, 0) });
};
const pass = async (ms) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushPromises();
};
/* Each read of the goal takes the next recorded answer, and the last one from then on. */
const readsAnswer = (...names) => {
    const left = [...names];
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url === `${GOALS}/${DELIVERY}`) return reply(left.length > 1 ? left.shift() : left[0]);
        return method === 'get' && url === GOALS ? Promise.resolve({ data: { status: true, data: [] } }) : answer(method, url, body);
    });
};

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 15, 10, 0) });
    viewer = 'me';
    tasks = [FOOTER];
    answered = [];
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

describe('a target counted from tasks', () => {
    it('shows the server\'s count, its bar and when it was counted, with nothing to type a value into', async () => {
        await open('tasksRelinked');
        const target = targetOf('Release tasks');
        const stored = fixture.tasksRelinked.response.data.targets[0];

        expect(target.attributes('data-kind')).toBe('tasks');
        expect(at('glt-counted', target).text()).toBe('2 of 5 tasks done');
        expect(target.find('.glt__pct').text()).toBe('40%');
        expect(target.find('.glb').attributes('aria-valuenow')).toBe('40');
        const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stored.counted.at));
        expect(at('glt-counted-at', target).text()).toBe(`Counted ${when}`);
        expect(at('glt-updating', target).exists()).toBe(false);
        expect(at('glt-not-counted', target).exists()).toBe(false);
        expect(target.find('input').exists()).toBe(false);
        expect(at('glt-value-save', target).exists()).toBe(false);
    });

    it('names each list and task it counts, with its project', async () => {
        await open('tasksAdded');
        expect(chipsOf(at('glt-sources', targetOf('Release tasks')))).toEqual([['Sprint 1', 'Website'], ['Interviews', 'Hiring plan'], ['Fix the footer', 'Website']]);
        expect(apiRequest.mock.calls.filter(([, url]) => url === FIND)).toHaveLength(1);
    });

    it('does not name a list or task the person cannot open', async () => {
        tasks = [{ ...FOOTER, ProjectID: 'a-project-not-in-the-store' }];
        await open('tasksAdded', { projects: [PROJECTS[0]] });
        expect(chipsOf(at('glt-sources', targetOf('Release tasks')))).toEqual([['Sprint 1', 'Website'], ['A list you cannot open', ''], ['A task you cannot open', '']]);
        expect(wrapper.text()).not.toContain('Interviews');
        expect(wrapper.text()).not.toContain('Fix the footer');
    });

    it('says so when nothing is linked, and offers to link', async () => {
        await open('tasksAddedEmpty');
        const target = targetOf('Stretch tasks');
        expect(at('glt-empty', target).text()).toContain('No lists or tasks linked yet');
        expect(at('glt-counted', target).exists()).toBe(false);

        await click(at('glt-link', target));
        expect(at('gtf').exists()).toBe(true);
        expect(at('gsp-empty').text()).toBe('No lists or tasks linked yet');
        expect(document.activeElement).toBe(at('gsp-search').element);
    });
});

describe('a count the server is still making', () => {
    it('is said quietly, asked for again two seconds after each answer and no sooner, and left alone once it is in', async () => {
        fakeTimeouts();
        readsAnswer('tasksReadStale', 'tasksReadStale', 'tasksReadLeftOut');
        await open();
        expect(at('glt-updating', targetOf('Release tasks')).text()).toBe('Updating…');
        expect(at('glt-counted', targetOf('Release tasks')).text()).toBe('2 of 5 tasks done');
        expect(goalCalls()).toHaveLength(2);

        await pass(COUNT_POLL_MS - 1);
        expect(goalCalls()).toHaveLength(2);
        await pass(1);
        expect(goalCalls()).toHaveLength(4);
        expect(at('glt-updating', targetOf('Release tasks')).exists()).toBe(true);

        await pass(COUNT_POLL_MS - 1);
        expect(goalCalls()).toHaveLength(4);
        await pass(1);
        expect(goalCalls()).toHaveLength(6);
        expect(at('glt-updating', targetOf('Release tasks')).exists()).toBe(false);
        expect(at('glt-counted', targetOf('Release tasks')).text()).toBe('1 of 3 tasks done');

        await pass(COUNT_POLL_MS * 10);
        expect(goalCalls()).toHaveLength(6);
    });

    it('is not asked for sooner because someone changed a goal meanwhile', async () => {
        fakeTimeouts();
        readsAnswer('tasksReadStale');
        await open();
        const [, changed] = socket.on.mock.calls.find(([event]) => event === 'goalsChanged');

        await pass(1000);
        changed({ type: 'update' });
        await pass(REFETCH_DELAY_MS);
        expect(goalCalls()).toHaveLength(4);

        await pass(COUNT_POLL_MS - 1);
        expect(goalCalls()).toHaveLength(4);
        await pass(1);
        expect(goalCalls()).toHaveLength(6);
    });

    it('is not asked for for ever', async () => {
        fakeTimeouts();
        readsAnswer('tasksReadStale');
        await open();
        await pass(COUNT_POLL_MS * (COUNT_POLL_LIMIT + 5));
        expect(goalCalls()).toHaveLength(2 + 2 * COUNT_POLL_LIMIT);
        expect(at('glt-updating', targetOf('Release tasks')).exists()).toBe(true);
    });

    it('stops being asked for when the page is left', async () => {
        fakeTimeouts();
        readsAnswer('tasksReadStale');
        await open();
        wrapper.unmount();
        wrapper = null;
        await pass(COUNT_POLL_MS * 3);
        expect(goalCalls()).toHaveLength(2);
    });
});

describe('linked lists and tasks that are left out of the count', () => {
    it('are counted for a reader, who is told how many and is given no names', async () => {
        await open('tasksReadLeftOutReader', { as: 'sam' });
        const target = targetOf('Release tasks');
        expect(at('glt-counted', target).text()).toBe('1 of 3 tasks done');
        expect(at('glt-not-counted', target).text()).toBe('1 linked list or task is not counted for this goal\'s readers.');
        expect(chipsOf(target)).toEqual([['Sprint 1', 'Website']]);
        expect(wrapper.text()).not.toContain('Backlog');
        expect(all('gsc-remove', target)).toHaveLength(0);
    });

    it('are named for someone who can edit the goal, who can take each one out', async () => {
        await open('tasksReadLeftOut');
        const leftOut = at('glt-not-counted', targetOf('Release tasks'));
        expect(leftOut.text()).toContain('1 linked list or task is not counted for this goal\'s readers.');
        expect(chipsOf(leftOut)).toEqual([['Backlog', 'Website']]);
        expect(chipsOf(at('glt-sources', targetOf('Release tasks')))).toEqual([['Sprint 1', 'Website']]);

        await click(at('gsc-remove', chipOf('Backlog', leftOut)));
        expect(sentNames().pop()).toBe('tasksUncounted');
        expect(at('glt-not-counted', targetOf('Release tasks')).exists()).toBe(false);
        expect(chipsOf(targetOf('Release tasks'))).toEqual([['Sprint 1', 'Website']]);
    });
});

describe('making a target counted from tasks', () => {
    it('links lists from the person\'s projects and tasks from the search, and sends them as one set', async () => {
        await open('tasksGoal');
        await click(at('glp-add-target'));
        expect(at('gtf-kind').findAll('option').map((option) => option.text())).toEqual(['Number', 'Currency', 'True or false', 'Counted from tasks']);
        await at('gtf-kind').setValue('tasks');
        expect(at('gtf-target').exists()).toBe(false);
        expect(at('gsp-empty').text()).toBe('No lists or tasks linked yet');
        expect(all('gsp-list').map((option) => option.text())).toEqual(['Sprint 1Website', 'BacklogWebsite', 'Old sprintWebsite', 'InterviewsHiring plan · Autumn']);

        await at('gtf-name').setValue('Release tasks');
        await pickList('Sprint 1');
        await pickList('Interviews');
        expect(all('gsp-list').map((option) => option.text())).toEqual(['BacklogWebsite', 'Old sprintWebsite']);
        await pickTask('footer', 'Fix the footer');
        expect(apiRequest.mock.calls.find(([, url]) => url === SEARCH)).toEqual(['post', SEARCH, { query: 'footer' }]);
        expect(chipsOf(at('gsp'))).toEqual([['Sprint 1', 'Website'], ['Interviews', 'Hiring plan'], ['Fix the footer', 'Website']]);
        expect(at('gsp-empty').exists()).toBe(false);

        await at('gtf').trigger('submit');
        await flushPromises();
        expect(sentNames().pop()).toBe('tasksAdded');
        expect(at('gtf').exists()).toBe(false);
        expect(at('glt-counted', targetOf('Release tasks')).text()).toBe('2 of 6 tasks done');
    });

    it('offers a list filtered by what is typed, and a task only once', async () => {
        await open('tasksGoal');
        await click(at('glp-add-target'));
        await at('gtf-kind').setValue('tasks');
        await at('gsp-search').setValue('hiring');
        expect(all('gsp-list').map((option) => option.text())).toEqual(['InterviewsHiring plan · Autumn']);

        await pickTask('footer', 'Fix the footer');
        await at('gsp-search').setValue('foot');
        await vi.waitFor(() => expect(apiRequest.mock.calls.filter(([, url]) => url === SEARCH)).toHaveLength(2));
        await flushPromises();
        expect(all('gsp-task')).toHaveLength(0);

        await click(at('gsc-remove', chipOf('Fix the footer', at('gsp'))));
        expect(chipsOf(at('gsp'))).toEqual([]);
        expect(all('gsp-task').map((option) => option.text())).toEqual(['Fix the footerWebsite']);
    });
});

describe('changing what a target is counted from', () => {
    it('replaces the whole set, after a refusal that marks the list not every reader can open', async () => {
        await open('tasksOpened');
        await click(at('glt-edit', targetOf('Release tasks')));
        expect(chipsOf(at('gsp'))).toEqual([['Sprint 1', 'Website'], ['Fix the footer', 'Website']]);

        await pickList('Interviews');
        await at('gtf').trigger('submit');
        await flushPromises();
        expect(sentNames().pop()).toBe('tasksNotShared');
        expect(errorFor('sources').text()).toBe(en.Goals.error_source_not_shared);
        expect(refusedChips()).toEqual(['Interviews']);
        expect(at('gsp-search').attributes('aria-invalid')).toBe('true');

        await click(at('gsc-remove', chipOf('Interviews')));
        expect(errorFor('sources').exists()).toBe(false);
        expect(refusedChips()).toEqual([]);
        await click(at('gsc-remove', chipOf('Fix the footer')));
        await pickList('Backlog');
        await at('gtf').trigger('submit');
        await flushPromises();

        expect(sentNames().pop()).toBe('tasksRelinked');
        expect(at('gtf').exists()).toBe(false);
        expect(at('glt-counted', targetOf('Release tasks')).text()).toBe('2 of 5 tasks done');
        expect(chipsOf(at('glt-sources', targetOf('Release tasks')))).toEqual([['Sprint 1', 'Website'], ['Backlog', 'Website']]);
    });

    it('marks the one list the server did not find', async () => {
        await open('tasksAddedEmpty');
        await click(at('glp-add-target'));
        await at('gtf-kind').setValue('tasks');
        await at('gtf-name').setValue('Old tasks');
        await pickList('Sprint 1');
        await pickList('Old sprint');
        await at('gtf').trigger('submit');
        await flushPromises();

        expect(sentNames().pop()).toBe('tasksNotFound');
        expect(errorFor('sources').text()).toBe(en.Goals.error_source_not_found);
        expect(refusedChips()).toEqual(['Old sprint']);
    });

    it('says in its own words that a counted value cannot be set by hand', async () => {
        await open('tasksAddedEmpty');
        const target = store.getters['goals/open'].goal.targets[0];
        const refused = await store.dispatch('goals/setValue', { id: DELIVERY, target, value: '3' }).catch((error) => error);
        expect(sentNames().pop()).toBe('tasksValueRefused');
        expect(refused).toMatchObject({ kind: 'field', code: 'counted_from_tasks', field: 'current' });
        expect(en.Goals.error_counted_from_tasks).toBe('This target is counted from its tasks, so its value cannot be set by hand.');
    });
});

describe('sharing a goal more widely than its lists and tasks', () => {
    it('is refused next to Save with the lists at fault, and can be saved without them', async () => {
        await open('tasksAddedEmpty');
        await at('glp-vis-workspace').setValue(true);
        await click(at('glp-vis-save'));

        expect(sentNames().pop()).toBe('tasksWouldDrop');
        const refusal = at('glp-vis-drop');
        expect(refusal.attributes('role')).toBe('alert');
        expect(refusal.text()).toContain(en.Goals.error_sources_would_drop);
        expect(chipsOf(refusal)).toEqual([['Interviews', 'Hiring plan']]);
        expect(at('glp-vis-save').exists()).toBe(true);
        expect(at('glp-vis-drop-save').text()).toBe('Remove these and save');

        await click(at('glp-vis-drop-save'));
        expect(sentNames().slice(-2)).toEqual(['tasksDropped', 'tasksOpened']);
        expect(at('glp-vis-drop').exists()).toBe(false);
        expect(at('glp-vis-save').exists()).toBe(false);
        expect(at('glp-vis-workspace').element.checked).toBe(true);
        expect(chipsOf(at('glt-sources', targetOf('Release tasks')))).toEqual([['Sprint 1', 'Website'], ['Fix the footer', 'Website']]);
    });

    it('forgets the refusal when the person picks something else', async () => {
        await open('tasksAddedEmpty');
        await at('glp-vis-workspace').setValue(true);
        await click(at('glp-vis-save'));
        expect(at('glp-vis-drop').exists()).toBe(true);

        await at('glp-vis-people').setValue(true);
        expect(at('glp-vis-drop').exists()).toBe(false);
    });
});

describe('the limits', () => {
    const manyLists = Object.fromEntries(Array.from({ length: 21 }, (_, n) => [`list-${n}`, { _id: `list-${n}`, name: `List ${String(n).padStart(2, '0')}` }]));

    it('stop at 20 lists, in plain words', async () => {
        await open('tasksGoal', { projects: [{ _id: WEBSITE, ProjectName: 'Website', sprintsObj: manyLists, sprintsfolders: {} }] });
        await click(at('glp-add-target'));
        await at('gtf-kind').setValue('tasks');
        expect(at('gsp-full-lists').exists()).toBe(false);
        for (let n = 0; n < 20; n += 1) await click(all('gsp-list')[0]);

        expect(all('gsc-chip', at('gsp'))).toHaveLength(20);
        expect(at('gsp-full-lists').text()).toBe('A target counts at most 20 lists.');
        expect(all('gsp-list').map((option) => option.attributes('disabled'))).toEqual(['']);
        await click(all('gsp-list')[0]);
        expect(all('gsc-chip', at('gsp'))).toHaveLength(20);
    });

    it('stop at 100 tasks, in plain words', async () => {
        const linked = { sprintIds: [], taskIds: Array.from({ length: 100 }, (_, n) => `task-${n}`) };
        tasks = [{ ...FOOTER, _id: 'one-more' }];
        store = newStore();
        wrapper = mount(GoalSourcePicker, { props: { modelValue: linked }, global: { plugins: [store] }, attachTo: document.body });
        await at('gsp-search').setValue('footer');
        await vi.waitFor(() => expect(all('gsp-task')).toHaveLength(1));

        expect(at('gsp-full-tasks').text()).toBe('A target counts at most 100 tasks.');
        expect(all('gsp-task')[0].attributes('disabled')).toBe('');
        await click(all('gsp-task')[0]);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });
});

describe('someone who can read the goal and not change it', () => {
    it('sees what is counted, and nothing to change it with', async () => {
        await open('tasksReadReader', { as: 'sam' });
        const target = targetOf('Release tasks');
        expect(at('glt-counted', target).text()).toBe('2 of 5 tasks done');
        expect(chipsOf(at('glt-sources', target))).toEqual([['Sprint 1', 'Website'], ['Backlog', 'Website']]);
        expect(all('gsc-remove')).toHaveLength(0);
        expect(at('glt-edit').exists()).toBe(false);
        expect(at('glt-remove').exists()).toBe(false);
        expect(at('glp-add-target').exists()).toBe(false);

        const empty = targetOf('Stretch tasks');
        expect(at('glt-empty', empty).text()).toBe('No lists or tasks linked yet');
        expect(at('glt-link', empty).exists()).toBe(false);
    });
});
