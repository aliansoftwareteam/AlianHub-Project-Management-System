import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => ({ default: { name: 'TimesheetTabs', render: () => null } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Approvals from '@/views/Approvals/Approvals.vue';

const OWNER = 1;
const PROPOSALS = '/api/v2/agents/proposals';

const plan = (over = {}) => ({
    kind: 'setup',
    title: 'Website',
    lines: [
        { kind: 'place', project: 'Website', list: '' },
        { kind: 'newStatuses', names: ['In Review', 'Blocked'], picks: ['statuses:0', 'statuses:1'] },
        { kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] },
        { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:0' },
    ],
    needs: { 'tasks:0': ['lists:0'] },
    ...over,
});
const forMember = () => plan({ locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'own_rights' } });
const setup = (preview) => ({ action: 'project.setup', params: { projectId: 'p-web' }, label: 'Set up the project', reversible: true, ...(preview ? { preview } : {}) });
const moveTask = { action: 'task.move', params: { taskId: 't1' }, label: 'Move task', reversible: true };
const proposal = (id, over = {}) => ({
    _id: id, agentName: 'Claude', what: `Change ${id}`, why: 'Asked for in chat', status: 'pending', locked: false,
    changes: [setup(plan())], createdAt: '2026-09-22T10:00:00.000Z', ...over,
});

let serverProposals;
let approveAnswer;
const respond = (type, url) => {
    const u = String(url);
    if (type === 'post') return Promise.resolve({ data: { status: true, data: approveAnswer } });
    if (u.startsWith(PROPOSALS)) return Promise.resolve({ data: { status: true, data: serverProposals, counts: { waiting: serverProposals.length } } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

let wrapper;
const open = async () => {
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } } });
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store, i18n], mocks: { $t: i18n.global.t } } });
    await flushPromises();
    return wrapper;
};

const card = () => wrapper.find('.ap__card--agent');
const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
const sent = () => apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url, body]) => [url.split('/').slice(-2).join('/'), body]);
const approve = async () => { await card().find('.tv-row-actions .ah-btn--primary').trigger('click'); await flushPromises(); };

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(respond);
    serverProposals = [];
    approveAnswer = { applied: [{ ok: true }] };
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('a waiting plan on the Approvals page', () => {
    it('is drawn with the card the Inbox draws it with, a ticked box on each part', async () => {
        serverProposals = [proposal('p1')];
        await open();
        expect(card().findAll('[data-test="intent-preview"]')).toHaveLength(1);
        const boxes = card().findAll('[data-test="intent-pick"]');
        expect(boxes.map((el) => el.attributes('data-pick'))).toEqual(['statuses:0', 'statuses:1', 'lists:0', 'tasks:0']);
        expect(boxes.every((el) => el.element.checked && !el.element.disabled)).toBe(true);
    });

    it('marks a part the reader may not approve, holds it unticked and leaves it out of what is sent', async () => {
        serverProposals = [proposal('p1', { changes: [setup(forMember())] })];
        await open();
        expect(box('statuses:1').element.checked).toBe(false);
        expect(box('statuses:1').element.disabled).toBe(true);
        expect(card().find('[data-test="intent-pick-locked"]').text()).toBe(en.IntentPreview.pick_locked_rights);
        await approve();
        expect(sent()).toEqual([['p1/approve', { parts: { 0: { statuses: [0], lists: [0], tasks: [0] } } }]]);
    });

    it('sends only the parts that stayed ticked, with what each one needs', async () => {
        serverProposals = [proposal('p1')];
        await open();
        await box('lists:0').trigger('change');
        await approve();
        expect(sent()).toEqual([['p1/approve', { parts: { 0: { statuses: [0, 1], lists: [], tasks: [] } } }]]);
    });

    it('is approved as one while nothing is locked and every part is ticked', async () => {
        serverProposals = [proposal('p1')];
        await open();
        await approve();
        expect(sent()).toEqual([['p1/approve', {}]]);
        expect(wrapper.find('.ap__card--agent').exists()).toBe(false);
    });

    it('says what stays waiting and lists the waiting part as a card of its own', async () => {
        serverProposals = [proposal('p1', { changes: [setup(forMember())] })];
        approveAnswer = { applied: [{ ok: true }], left: { waiting: ['p9'], retry: [] } };
        await open();
        serverProposals = [proposal('p9', { what: 'The part left waiting', changes: [moveTask] })];
        await approve();
        expect(wrapper.find('.tv-ok').text()).toContain(en.Inbox.queue_left_waiting);
        expect(wrapper.findAll('.ap__card--agent')).toHaveLength(1);
        expect(card().text()).toContain('The part left waiting');
    });

    it('offers no box on a plan the reader may not approve at all', async () => {
        serverProposals = [proposal('p1', { locked: true, lockedWhy: 'own_rights' })];
        await open();
        expect(card().find('[data-test="intent-preview"]').exists()).toBe(true);
        expect(card().findAll('[data-test="intent-pick"]')).toHaveLength(0);
    });

    it('offers no Approve on a proposal the reader may not approve, as the Inbox does', async () => {
        serverProposals = [proposal('p1', { locked: true, lockedWhy: 'own_rights' }), proposal('p2', { changes: [moveTask] })];
        await open();
        const [locked, approvable] = wrapper.findAll('.ap__card--agent');
        expect(locked.find('.tv-row-actions .ah-btn--primary').exists()).toBe(false);
        expect(approvable.find('.tv-row-actions .ah-btn--primary').exists()).toBe(true);
    });
});

describe('a waiting proposal that is not a plan, on the Approvals page', () => {
    it('shows no card and is approved whole as before', async () => {
        serverProposals = [proposal('p1', { changes: [moveTask] })];
        await open();
        expect(card().find('[data-test="intent-preview"]').exists()).toBe(false);
        expect(card().text()).toContain('Asked for in chat');
        await approve();
        expect(sent()).toEqual([['p1/approve', {}]]);
    });
});
