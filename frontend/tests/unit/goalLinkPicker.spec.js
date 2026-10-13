/* Task 046 M3: "Count toward a goal…" on a task and on a list. The goals a person can edit come from
   the goals list, asked for when a menu holding the entry is opened and never before; the picker adds
   the task or the list to a target by sending the target's whole set of sources with it, or makes a
   new target, and words a refusal the way the Goals page does. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { routerKey } from 'vue-router';
import { h, ref } from 'vue';
import fs from 'fs';
import path from 'path';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import GoalLinkPicker from '@/views/Goals/GoalLinkPicker.vue';
import { FRESH_FOR_MS, linkableGoals, loadLinkableGoals, noteLinked, resetLinkableGoals, useGoalLinking } from '@/views/Goals/goalLinking';

const CID = 'company-1';
const GOALS = '/api/v2/goals';
const TASK = { kind: 'taskIds', id: 'task-1', name: 'Write the copy' };
const LIST = { kind: 'sprintIds', id: 'list-9', name: 'Launch' };
const tasksTarget = (id, name, sources = {}) => ({ id, name, kind: 'tasks', weight: 1, sources: { sprintIds: [], taskIds: [], ...sources } });
const goal = (id, name, targets = [], over = {}) => ({ _id: id, name, canEdit: true, archived: false, targets, ...over });
const LAUNCH = goal('g-launch', 'Launch the site', [
    { id: 't-num', name: 'Customers', kind: 'number', weight: 1 },
    tasksTarget('t-launch', 'Launch tasks', { sprintIds: ['list-1'], taskIds: ['task-7'] }),
    tasksTarget('t-docs', 'Docs tasks')
]);
const BRAND = goal('g-brand', 'Brand refresh');
const READ_ONLY = goal('g-read', 'Company goal', [tasksTarget('t-co', 'Company tasks')], { canEdit: false });
const ARCHIVED = goal('g-old', 'Last year', [], { archived: true });

let listed = [];
const answerWith = (write) => apiRequest.mockImplementation((method, url, body) => {
    if (method === 'get' && url === GOALS) return Promise.resolve({ data: { status: true, data: listed } });
    return write(method, url, body);
});
const saved = (answer) => Promise.resolve({ data: { status: true, data: answer } });
const refused = (status, data = {}) => Promise.reject({ response: { status, data: { status: false, ...data } } });
const writes = () => apiRequest.mock.calls.filter(([method]) => method !== 'get');

const router = { hasRoute: vi.fn(() => true), push: vi.fn(() => Promise.resolve()) };
const provided = () => ({ $companyId: ref(CID), [routerKey]: router });

let wrapper;
const open = async (source = TASK) => {
    wrapper = mount(GoalLinkPicker, { props: { source }, global: { provide: provided() }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
/* A menu that holds the entry: it shows whether the entry is offered, and asks for the goals when pressed. */
const menuFor = (roleType) => {
    const Menu = {
        setup() {
            const { offered, prefetch } = useGoalLinking();
            return () => h('button', { 'data-offered': String(offered.value), onClick: prefetch });
        }
    };
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => (roleType === undefined ? undefined : { roleType }) } } } });
    wrapper = mount(Menu, { global: { plugins: [store], provide: provided() } });
    return wrapper.find('button');
};
const at = (name) => document.body.querySelector(`[data-test="${name}"]`);
const optionsOf = (name) => [...at(name).querySelectorAll('option')].map((option) => [option.textContent.trim(), option.disabled]);
const choose = async (name, value) => {
    at(name).value = value;
    at(name).dispatchEvent(new Event('change'));
    await flushPromises();
};
const type = async (name, value) => {
    at(name).value = value;
    at(name).dispatchEvent(new Event('input'));
    await flushPromises();
};
const submit = async () => {
    at('glk').dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
};

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    resetLinkableGoals();
    listed = [LAUNCH, BRAND, READ_ONLY, ARCHIVED];
    apiRequest.mockReset();
    answerWith(() => saved(LAUNCH));
    Object.values(toast).forEach((spy) => spy.mockReset());
    router.push.mockClear();
    router.hasRoute.mockImplementation(() => true);
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('the entry', () => {
    it('is offered to anyone who could own a goal, in a build that has the Goals page', () => {
        expect(menuFor(3).attributes('data-offered')).toBe('true');
        wrapper.unmount();
        expect(menuFor(1).attributes('data-offered')).toBe('true');
    });

    it('is not offered to a guest, before the person\'s role is known, or without the Goals page', () => {
        expect(menuFor(0).attributes('data-offered')).toBe('false');
        wrapper.unmount();
        expect(menuFor(undefined).attributes('data-offered')).toBe('false');
        wrapper.unmount();
        router.hasRoute.mockImplementation(() => false);
        expect(menuFor(3).attributes('data-offered')).toBe('false');
        expect(router.hasRoute).toHaveBeenCalledWith('Goals');
    });

    it('asks for nobody\'s goals until a menu holding it is opened, and then once', async () => {
        const button = menuFor(3);
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();

        await button.trigger('click');
        await button.trigger('click');
        await flushPromises();
        await button.trigger('click');
        expect(apiRequest.mock.calls).toEqual([['get', GOALS]]);
    });

    it('never asks for a guest', async () => {
        const button = menuFor(0);
        await button.trigger('click');
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('the goals a person can count work toward', () => {
    it('are the ones the goals list says they can edit, and not an archived one', async () => {
        await loadLinkableGoals(CID);
        expect(apiRequest.mock.calls).toEqual([['get', GOALS]]);
        expect(linkableGoals.goals.map((entry) => entry._id)).toEqual(['g-launch', 'g-brand']);
    });

    it('are read once for a workspace however many menus ask, and again for another workspace', async () => {
        await Promise.all([loadLinkableGoals(CID), loadLinkableGoals(CID)]);
        await loadLinkableGoals(CID);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        await loadLinkableGoals('company-2');
        expect(apiRequest).toHaveBeenCalledTimes(2);
    });

    it('stay as they were when the list cannot be read', async () => {
        await loadLinkableGoals(CID);
        apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        await loadLinkableGoals(CID, { again: true });
        expect(linkableGoals.status).toBe('failed');
        expect(linkableGoals.goals).toHaveLength(2);
    });
});

describe('the picker', () => {
    it('asks for the goals itself when no menu did, and waits for a read that is under way', async () => {
        await open();
        expect(apiRequest.mock.calls).toEqual([['get', GOALS]]);
        wrapper.unmount();

        resetLinkableGoals();
        apiRequest.mockClear();
        loadLinkableGoals(CID);
        await open();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(optionsOf('glk-goal')).toEqual([['Brand refresh', false], ['Launch the site', false]]);
    });

    it('does not read again a list the menu read a moment ago, and does read an older one', async () => {
        await loadLinkableGoals(CID);
        await open();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        wrapper.unmount();

        linkableGoals.loadedAt = Date.now() - FRESH_FOR_MS;
        await open();
        expect(apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url === GOALS)).toHaveLength(2);
        expect(at('glk').getAttribute('role')).toBe('dialog');
        expect(document.body.textContent).toContain('Pick the target whose progress should count the task Write the copy.');
        expect(optionsOf('glk-goal')).toEqual([['Brand refresh', false], ['Launch the site', false]]);
    });

    it('offers the targets counted from tasks of the chosen goal, and a new one', async () => {
        await open();
        expect(at('glk-goal').value).toBe('g-brand');
        expect(optionsOf('glk-target')).toEqual([['New target…', false]]);
        expect(at('glk-name').value).toBe('Write the copy');

        await choose('glk-goal', 'g-launch');
        expect(optionsOf('glk-target')).toEqual([['Launch tasks', false], ['Docs tasks', false], ['New target…', false]]);
        expect(at('glk-target').value).toBe('t-launch');
        expect(at('glk-name')).toBeNull();
    });

    it('sends the target\'s whole set of sources with the task added', async () => {
        await open();
        await choose('glk-goal', 'g-launch');
        await submit();
        expect(writes()).toEqual([['patch', `${GOALS}/g-launch/targets/t-launch`, { sources: { sprintIds: ['list-1'], taskIds: ['task-7', 'task-1'] } }]]);
        expect(toast.success).toHaveBeenCalledWith('Write the copy now counts toward Launch tasks.', { position: 'top-right' });
        expect(wrapper.emitted('linked')).toHaveLength(1);
        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(linkableGoals.linked).toBe(1);
    });

    it('adds a list to the lists of the set', async () => {
        await open(LIST);
        expect(document.body.textContent).toContain('Pick the target whose progress should count the top-level tasks of the list Launch.');
        await choose('glk-goal', 'g-launch');
        await choose('glk-target', 't-docs');
        await submit();
        expect(writes()).toEqual([['patch', `${GOALS}/g-launch/targets/t-docs`, { sources: { sprintIds: ['list-9'], taskIds: [] } }]]);
    });

    it('makes a new target counted from the task alone', async () => {
        answerWith(() => saved(goal('g-brand', 'Brand refresh', [tasksTarget('t-new', 'Copy done', { taskIds: ['task-1'] })])));
        await open();
        await type('glk-name', '  Copy done ');
        await submit();
        expect(writes()).toEqual([['post', `${GOALS}/g-brand/targets`, { kind: 'tasks', name: 'Copy done', weight: 1, sources: { sprintIds: [], taskIds: ['task-1'] } }]]);
        expect(toast.success).toHaveBeenCalledWith('Write the copy now counts toward Copy done.', { position: 'top-right' });
        expect(linkableGoals.goals.find((entry) => entry._id === 'g-brand').targets).toHaveLength(1);
    });

    it('asks for a name before making a target', async () => {
        await open();
        await type('glk-name', '   ');
        await submit();
        expect(writes()).toEqual([]);
        expect(at('glk-error').textContent).toBe('Give it a name of up to 120 characters.');
    });

    it('does not offer a target that already counts it', async () => {
        listed = [goal('g-launch', 'Launch the site', [tasksTarget('t-launch', 'Launch tasks', { taskIds: ['task-1'] }), tasksTarget('t-docs', 'Docs tasks')])];
        await open();
        expect(optionsOf('glk-target')).toEqual([['Launch tasks (already counts it)', true], ['Docs tasks', false], ['New target…', false]]);
        expect(at('glk-target').value).toBe('t-docs');
    });

    it('says a target is full without asking the server', async () => {
        listed = [goal('g-launch', 'Launch the site', [tasksTarget('t-full', 'Full', { taskIds: Array.from({ length: 100 }, (_, n) => `t${n}`) })])];
        await open();
        await submit();
        expect(writes()).toEqual([]);
        expect(at('glk-error').textContent).toBe('A target counts at most 100 tasks.');
    });

    it.each([
        ['a source not every reader can open', 400, { code: 'source_not_shared', field: 'sources.taskIds.1', sources: { sprintIds: [], taskIds: ['task-1'] } }, en.Goals.error_source_not_shared],
        ['a source the person cannot open', 400, { code: 'source_not_found', field: 'sources.taskIds.1' }, en.Goals.error_source_not_found],
        ['a refusal with no code', 400, { field: 'sources' }, en.Goals.error_sources],
        ['a goal the person may no longer change', 403, {}, en.Goals.not_allowed],
        ['a goal changed meanwhile', 409, {}, en.Goals.conflict],
        ['a server that failed', 500, {}, en.Goals.save_failed]
    ])('shows the Goals page\'s own words for %s, and stays open', async (_case, status, data, words) => {
        answerWith(() => refused(status, data));
        await open();
        await choose('glk-goal', 'g-launch');
        await submit();
        expect(at('glk-error').textContent).toBe(words);
        expect(at('glk-error').getAttribute('role')).toBe('alert');
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(toast.success).not.toHaveBeenCalled();
        expect(linkableGoals.linked).toBe(0);
        expect(at('glk-save').disabled).toBe(false);
    });

    it('says so when the person has no goal to edit, and leads to a new one', async () => {
        listed = [READ_ONLY, ARCHIVED];
        await open();
        expect(at('glk-none').textContent).toContain('You have no goals you can edit.');
        expect(at('glk-save').disabled).toBe(true);
        expect(at('glk-new-goal').textContent).toBe('New goal');

        at('glk-new-goal').click();
        expect(router.push).toHaveBeenCalledWith({ name: 'Goals', params: { cid: CID }, query: { new: '1' } });
        expect(wrapper.emitted('close')).toHaveLength(1);
        wrapper.unmount();

        resetLinkableGoals();
        router.hasRoute.mockImplementation(() => false);
        await open();
        expect(at('glk-none').textContent).toContain('You have no goals you can edit.');
        expect(at('glk-new-goal')).toBeNull();
    });

    it('says so when the goals cannot be read, and reads them again when asked', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        await open();
        expect(at('glk-failed').textContent).toContain('Your goals could not be loaded.');
        listed = [LAUNCH];
        answerWith(() => saved(LAUNCH));
        at('glk-failed').querySelector('button').click();
        await flushPromises();
        expect(optionsOf('glk-goal')).toEqual([['Launch the site', false]]);
    });

    it('closes from Cancel, from Escape and from the backdrop, without a write', async () => {
        await open();
        at('glk-cancel').click();
        at('glk').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.querySelector('.glk__overlay').click();
        expect(wrapper.emitted('close')).toHaveLength(3);
        expect(writes()).toEqual([]);
    });

    it('keeps what a write answered for the next link', () => {
        linkableGoals.goals = [LAUNCH];
        noteLinked(goal('g-launch', 'Launch the site', [tasksTarget('t-launch', 'Launch tasks', { taskIds: ['task-1'] })]));
        expect(linkableGoals.goals[0].targets[0].sources.taskIds).toEqual(['task-1']);
        noteLinked(null);
        expect(linkableGoals.linked).toBe(2);
    });
});

describe('the task panel\'s menu', () => {
    const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');
    const actions = read('components/molecules/TaskDetailAction/TaskDetailAction.vue');

    it('offers the entry by the shared rule, asks for the goals when the menu is pressed, and opens the picker for the task', () => {
        expect(actions).toContain('<DropDownOption v-if="goalsOffered" data-test="task-count-toward-goal" @click="linkingGoal = true">');
        expect(actions).toContain("{{$t('Goals.count_toward')}}");
        expect(actions).toContain('<GoalLinkPicker v-if="linkingGoal" :source="{ kind: \'taskIds\', id: props.task._id, name: props.task.TaskName }" @close="linkingGoal = false" />');
        expect(actions).toContain('const { offered: goalsOffered, prefetch: prefetchGoals } = useGoalLinking();');
        expect(actions).toContain('@isVisible="(shown) => shown && prefetchGoals()"');
        expect(actions).not.toContain('loadLinkableGoals');
        expect(en.Goals.count_toward).toBe('Count toward a goal…');
    });

    it('reads its goals again after a link, so the new chip shows', () => {
        expect(read('components/organisms/TaskDetailOverlay/TaskGoals.vue')).toContain('watch(() => linkableGoals.linked, () => load(props.taskId));');
    });
});
