/* Task 046 M3, slice G3: the Goals store. `@/services` answers from tests/fixtures/goalResponses.json,
   which the server's own handlers recorded for the requests this store sends (tests/goals-fixture.test.js
   at the repo root), so a request that was never recorded is one the page should not be making. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import fixture from '../fixtures/goalResponses.json';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import goals from '@/store/Goals';
import { REFETCH_DELAY_MS } from '@/store/Goals';

const GOALS = '/api/v2/goals';
const SAM = '6f0000000000000000000002';
const GONE = '6f0000000000000000000005';
const REVENUE = '6f0000000000000000000e01';
const CHURN = '6f0000000000000000000e02';
const HIRING = '6f0000000000000000000e03';
const SECRET = '6f0000000000000000000e06';
const CREATED = fixture.created.response.data._id;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let viewer = 'me';
let prefer = [];
const recordedAs = (method, url, body) => {
    const hits = Object.keys(fixture).filter((name) => {
        const { as, request } = fixture[name];
        return as === viewer && request.method === method && request.path === url && same(request.body, body);
    });
    return hits.find((name) => prefer.includes(name)) || hits[0];
};
const answer = (method, url, body) => {
    const name = recordedAs(method, url, body);
    if (!name) return Promise.reject(new Error(`a request the server never recorded: ${method} ${url} ${JSON.stringify(body)}`));
    const { statusCode, response } = fixture[name];
    return statusCode === 200 ? Promise.resolve({ data: response }) : Promise.reject({ response: { status: statusCode, data: response } });
};
const sentNames = () => apiRequest.mock.calls.map(([method, url, body]) => recordedAs(method, url, body));
const refusal = (run) => run.then(() => { throw new Error('the write was not refused'); }, (error) => error);

let store;
const list = () => store.getters['goals/goals'];
const names = () => list().map((goal) => goal.name);
const goal = (id) => store.getters['goals/goalById'](id);
const opened = () => store.getters['goals/open'];
const load = (options) => store.dispatch('goals/load', options);

beforeEach(() => {
    viewer = 'me';
    prefer = [];
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    store = createStore({ modules: { goals } });
});
afterEach(() => vi.useRealTimers());

describe('the list', () => {
    it('reads the goals the person can see, in the server\'s order', async () => {
        expect(store.getters['goals/status']).toBe('idle');
        await load();
        expect(apiRequest.mock.calls[0].slice(0, 2)).toEqual(['get', GOALS]);
        expect(store.getters['goals/status']).toBe('ready');
        expect(names()).toEqual(['Cut churn', 'Grow revenue', 'Hire the team', 'Refresh the brand']);
    });

    it('asks again when the filters change: mine, or archived', async () => {
        await store.dispatch('goals/applyFilters', { mine: true });
        expect(sentNames()).toEqual(['listMine']);
        expect(names()).toEqual(['Cut churn', 'Grow revenue', 'Hire the team']);

        await store.dispatch('goals/applyFilters', { mine: false, archived: true });
        expect(sentNames().at(-1)).toBe('listArchived');
        expect(names()).toEqual(['Launch v1']);
        expect(store.getters['goals/filters']).toEqual({ mine: false, archived: true });
    });

    it('is only what is shared with them for a guest', async () => {
        viewer = 'gil';
        await load();
        expect(names()).toEqual(['Client rollout']);
        expect(list()[0]).toMatchObject({ canEdit: false, canSetValue: false, sharedWithMe: true });
    });

    it('reports a failure, and loads again when asked', async () => {
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
        await load();
        expect(store.getters['goals/status']).toBe('error');
        await load();
        expect(store.getters['goals/status']).toBe('ready');
        expect(names()).toHaveLength(4);
    });

    it('keeps the goals on screen through a quiet reload', async () => {
        await load();
        const reading = load({ quiet: true });
        expect(store.getters['goals/status']).toBe('ready');
        expect(names()).toHaveLength(4);
        await reading;
        expect(apiRequest).toHaveBeenCalledTimes(2);
    });
});

describe('one goal', () => {
    it('opens from the list without asking again', async () => {
        await load();
        await store.dispatch('goals/open', REVENUE);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(opened()).toMatchObject({ id: REVENUE, status: 'ready', goal: { name: 'Grow revenue' } });
    });

    it('is read on its own when the list does not hold it', async () => {
        await store.dispatch('goals/open', CREATED);
        expect(sentNames()).toEqual(['readArchived']);
        expect(opened()).toMatchObject({ id: CREATED, status: 'ready', goal: { archived: true } });
    });

    it('says a goal the person cannot read is missing', async () => {
        await store.dispatch('goals/open', SECRET);
        expect(sentNames()).toEqual(['readMissing']);
        expect(opened()).toMatchObject({ id: SECRET, status: 'missing', goal: null });
    });

    it('is forgotten when it is closed', async () => {
        await load();
        await store.dispatch('goals/open', REVENUE);
        store.dispatch('goals/close');
        expect(opened()).toEqual({ id: '', status: 'idle', goal: null });
    });
});

describe('a new goal', () => {
    it('is posted, and takes its place in the list by name', async () => {
        await load();
        const made = await store.dispatch('goals/create', { name: '  Ship the mobile app ', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
        expect(sentNames().at(-1)).toBe('created');
        expect(made).toMatchObject({ _id: CREATED, name: 'Ship the mobile app', visibility: 'private' });
        expect(names()).toEqual(['Cut churn', 'Grow revenue', 'Hire the team', 'Refresh the brand', 'Ship the mobile app']);
    });

    it('is not added when the server refuses it, and the refusal names the field', async () => {
        await load();
        const error = await refusal(store.dispatch('goals/create', { name: 'Backwards', periodStart: '2026-12-31', periodEnd: '2026-10-01' }));
        expect(error).toMatchObject({ kind: 'field', field: 'periodEnd', status: 400 });
        expect(names()).toHaveLength(4);
    });

    it('is refused to a guest as forbidden', async () => {
        viewer = 'gil';
        await load();
        expect(await refusal(store.dispatch('goals/create', { name: 'A guest\'s goal' }))).toMatchObject({ kind: 'forbidden', status: 403 });
    });
});

describe('a change to a goal', () => {
    beforeEach(() => load());

    it('replaces the goal in the list and in the open panel', async () => {
        await store.dispatch('goals/open', REVENUE);
        await store.dispatch('goals/update', { id: REVENUE, changes: { description: 'Net new revenue, all regions' } });
        expect(sentNames().at(-1)).toBe('described');
        expect(goal(REVENUE).description).toBe('Net new revenue, all regions');
        expect(opened().goal.description).toBe('Net new revenue, all regions');
    });

    it('that the server refuses names the field and leaves the goal as it was', async () => {
        const error = await refusal(store.dispatch('goals/update', { id: CHURN, changes: { sharedWith: [GONE] } }));
        expect(error).toMatchObject({ kind: 'field', field: 'sharedWith' });
        expect(goal(CHURN)).toMatchObject({ visibility: 'private', sharedWith: [] });
    });

    it('that answers with no goal takes the goal off the list: it is no longer theirs to see', async () => {
        await store.dispatch('goals/create', { name: '  Ship the mobile app ', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
        await store.dispatch('goals/open', CREATED);
        const result = await store.dispatch('goals/update', { id: CREATED, changes: { ownerUserId: SAM } });
        expect(sentNames().at(-1)).toBe('handedOver');
        expect(result).toBeNull();
        expect(goal(CREATED)).toBeNull();
        expect(names()).toHaveLength(4);
        expect(opened()).toMatchObject({ id: CREATED, status: 'gone', goal: null });
    });

    it('that lost a race, or met an archived goal, reads the goal again and says so', async () => {
        await store.dispatch('goals/create', { name: '  Ship the mobile app ', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
        await store.dispatch('goals/open', CREATED);
        const error = await refusal(store.dispatch('goals/update', { id: CREATED, changes: { name: 'Too late' } }));
        expect(error).toMatchObject({ kind: 'conflict', status: 409 });
        expect(sentNames().slice(-2)).toEqual(['archivedRefused', 'readArchived']);
        expect(opened().goal).toMatchObject({ name: 'Ship the mobile app', archived: true });
        expect(goal(CREATED)).toBeNull();
    });

    it('that is not theirs to make reads the goal again and says so', async () => {
        const error = await refusal(store.dispatch('goals/update', { id: HIRING, changes: { name: 'Taken' } }));
        expect(error).toMatchObject({ kind: 'forbidden', status: 403 });
        expect(sentNames().slice(-2)).toEqual(['editRefused', 'readShared']);
        expect(goal(HIRING).name).toBe('Hire the team');
    });

    it('archives a goal out of the live list and restores it into it', async () => {
        await store.dispatch('goals/create', { name: '  Ship the mobile app ', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
        await store.dispatch('goals/open', CREATED);
        await store.dispatch('goals/archive', CREATED);
        expect(sentNames().at(-1)).toBe('archived');
        expect(goal(CREATED)).toBeNull();
        expect(opened().goal.archived).toBe(true);

        await store.dispatch('goals/restore', CREATED);
        expect(sentNames().at(-1)).toBe('restored');
        expect(goal(CREATED)).toMatchObject({ archived: false });
        expect(opened().goal.archived).toBe(false);
    });
});

describe('a target', () => {
    beforeEach(() => load());
    const customers = () => goal(REVENUE).targets[0];

    it('shows its new value at once, and the server\'s numbers when they arrive', async () => {
        let arrive;
        apiRequest.mockImplementationOnce(() => new Promise((resolve) => { arrive = resolve; }));
        const saving = store.dispatch('goals/setValue', { id: REVENUE, target: customers(), value: '5' });
        expect(apiRequest.mock.calls.at(-1)).toEqual(['put', `${GOALS}/${REVENUE}/targets/${customers().id}/value`, { current: 5 }]);
        expect(customers()).toMatchObject({ current: 5, progressPct: 30, saving: true });

        arrive({ data: fixture.valueSet.response });
        await saving;
        expect(customers()).toMatchObject({ current: 5, progressPct: 50 });
        expect(customers().saving).toBeUndefined();
        expect(goal(REVENUE).progressPct).toBe(38);
    });

    it('goes back to what it was when the server refuses, and the goal is read again', async () => {
        const offer = goal(HIRING).targets[0];
        let refuse;
        apiRequest.mockImplementationOnce(() => new Promise((resolve, reject) => { refuse = reject; }));
        const saving = refusal(store.dispatch('goals/setValue', { id: HIRING, target: offer, value: true }));
        expect(goal(HIRING).targets[0]).toMatchObject({ done: true, saving: true });

        refuse({ response: { status: 403, data: fixture.valueRefused.response } });
        expect(await saving).toMatchObject({ kind: 'forbidden' });
        expect(goal(HIRING).targets[0]).toMatchObject({ done: false });
        expect(goal(HIRING).targets[0].saving).toBeUndefined();
        expect(sentNames().at(-1)).toBe('readShared');
    });

    it('goes back when the value itself is refused, naming the field', async () => {
        const error = await refusal(store.dispatch('goals/setValue', { id: REVENUE, target: customers(), value: '1e16' }));
        expect(error).toMatchObject({ kind: 'field', field: 'current' });
        expect(customers()).toMatchObject({ current: 3, progressPct: 30 });
    });

    it('unticks a true-or-false target with one request', async () => {
        await store.dispatch('goals/setValue', { id: REVENUE, target: goal(REVENUE).targets[2], value: false });
        expect(sentNames().at(-1)).toBe('valueUnticked');
        expect(goal(REVENUE).targets[2]).toMatchObject({ done: false, progressPct: 0 });
    });

    it('keeps a value that is still being saved when the list is read again underneath it', async () => {
        let arrive;
        apiRequest.mockImplementationOnce(() => new Promise((resolve) => { arrive = resolve; }));
        const saving = store.dispatch('goals/setValue', { id: REVENUE, target: customers(), value: '5' });
        await load({ quiet: true });
        expect(customers()).toMatchObject({ current: 5, saving: true });
        arrive({ data: fixture.valueSet.response });
        await saving;
        expect(customers()).toMatchObject({ current: 5, progressPct: 50 });
    });

    it('is added, changed and removed through the goal the server sends back', async () => {
        const added = await store.dispatch('goals/addTarget', { id: CHURN, form: { kind: 'currency', name: 'Revenue kept', start: '0', target: '20000', current: '', unit: '', currencyCode: 'EUR', weight: '2' } });
        expect(sentNames().at(-1)).toBe('targetAdded');
        expect(goal(CHURN).targets.map((entry) => entry.name)).toEqual(['Monthly churn', 'Revenue kept']);

        await store.dispatch('goals/editTarget', { id: CHURN, target: fixture.shared.response.data.targets[0], form: { name: 'Monthly churn rate', start: '40', target: '5', unit: '%', weight: '1' } });
        expect(sentNames().at(-1)).toBe('targetEdited');

        await store.dispatch('goals/removeTarget', { id: CHURN, targetId: added.targets[1].id });
        expect(sentNames().at(-1)).toBe('targetRemoved');
        expect(goal(CHURN).targets.map((entry) => entry.name)).toEqual(['Monthly churn rate', 'Exit survey sent']);
    });

    it('is not added when its currency is not one of the workspace\'s, and the refusal names the field', async () => {
        const error = await refusal(store.dispatch('goals/addTarget', { id: CHURN, form: { kind: 'currency', name: 'In pounds', start: '', target: '100', current: '', unit: '', currencyCode: 'GBP', weight: '1' } }));
        expect(error).toMatchObject({ kind: 'field', field: 'currencyCode' });
        expect(goal(CHURN).targets).toHaveLength(1);
    });
});

describe('a change made somewhere else', () => {
    it('reads the list again once, after the changes have stopped arriving', async () => {
        await load();
        await store.dispatch('goals/open', REVENUE);
        vi.useFakeTimers();
        store.dispatch('goals/changed');
        store.dispatch('goals/changed');
        vi.advanceTimersByTime(REFETCH_DELAY_MS - 1);
        store.dispatch('goals/changed');
        expect(apiRequest).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(REFETCH_DELAY_MS - 1);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        vi.useRealTimers();
        await flushPromises();
        expect(sentNames()).toEqual(['list', 'list']);
        expect(store.getters['goals/status']).toBe('ready');
        expect(opened()).toMatchObject({ id: REVENUE, status: 'ready' });
    });

    it('reads the open goal again too when the list does not hold it', async () => {
        await load();
        await store.dispatch('goals/open', CREATED);
        vi.useFakeTimers();
        store.dispatch('goals/changed');
        await vi.advanceTimersByTimeAsync(REFETCH_DELAY_MS);
        vi.useRealTimers();
        await flushPromises();
        expect(sentNames()).toEqual(['list', 'readArchived', 'list', 'readArchived']);
    });

    it('does not read anything before the page has loaded, or after it has gone', async () => {
        vi.useFakeTimers();
        store.dispatch('goals/changed');
        await vi.advanceTimersByTimeAsync(REFETCH_DELAY_MS);
        expect(apiRequest).not.toHaveBeenCalled();

        vi.useRealTimers();
        await load();
        vi.useFakeTimers();
        store.dispatch('goals/changed');
        store.dispatch('goals/stopWatching');
        await vi.advanceTimersByTimeAsync(REFETCH_DELAY_MS);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});
