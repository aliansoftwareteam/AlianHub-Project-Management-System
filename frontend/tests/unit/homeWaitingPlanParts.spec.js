import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import WaitingOnYouCard from '@/components/molecules/Home/WaitingOnYouCard.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const MEMBER = 3;
const blank = { render: () => null };

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
const forMember = () => plan({ locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'owner_admin' } });
const setup = (preview) => ({ action: 'project.setup', params: { projectId: 'p-web' }, label: 'Set up the project', reversible: true, ...(preview ? { preview } : {}) });
const proposal = (id, over = {}) => ({
    _id: id, status: 'pending', locked: false, agentName: 'Claude', what: `Change ${id}`, why: 'Asked for in chat',
    changes: [setup(plan())], createdAt: '2026-09-28T09:00:00Z', ...over,
});
const moveTask = { action: 'task.move', params: { taskId: 't1' }, label: 'Move task', reversible: true };

let serverProposals;
let approveAnswer;

const answer = (type, url) => {
    if (type === 'get' && url.includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: serverProposals, counts: { waiting: serverProposals.length } } });
    if (type === 'get' && url.includes('/workflows/approvals')) return Promise.resolve({ data: { status: true, data: [] } });
    if (type === 'post' && url.includes('/approve')) return Promise.resolve({ data: { status: true, data: approveAnswer } });
    return Promise.resolve({ data: { status: false } });
};

let wrapper;
const open = async () => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid', name: 'Home', component: blank },
            { path: '/:cid/ai/inbox', name: 'AiInbox', component: blank },
            { path: '/:cid/inbox', name: 'inbox', component: blank },
        ],
    });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: MEMBER }) } } } });
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(WaitingOnYouCard, { attachTo: document.body, global: { plugins: [store, router, i18n] } });
    await flushPromises();
    return wrapper;
};

const row = () => wrapper.find('[data-test="waiting-row"]');
const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
const sent = () => apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url, body]) => [url.split('/').slice(-2).join('/'), body]);
const review = async () => { await row().find('[data-test="waiting-review"]').trigger('click'); await flushPromises(); };
const approveParts = async () => { await wrapper.find('[data-test="waiting-parts-approve"]').trigger('click'); await flushPromises(); };

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    Object.values(toast).forEach((spy) => spy.mockReset());
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
    serverProposals = [];
    approveAnswer = { applied: [{ ok: true }] };
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('a waiting plan on Home', () => {
    it('is offered as parts to review, not approved whole from the row', async () => {
        serverProposals = [proposal('p1')];
        await open();
        expect(row().find('[data-test="waiting-approve"]').exists()).toBe(false);
        const button = row().find('[data-test="waiting-review"]');
        expect(button.text()).toBe('Review parts');
        expect(button.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('[data-test="intent-preview"]').exists()).toBe(false);
        await review();
        expect(button.attributes('aria-expanded')).toBe('true');
        expect(wrapper.findAll('[data-test="intent-pick"]').map((el) => el.attributes('data-pick'))).toEqual(['statuses:0', 'statuses:1', 'lists:0', 'tasks:0']);
    });

    it('marks a part the reader may not approve, holds it unticked and leaves it out of what is sent', async () => {
        serverProposals = [proposal('p1', { changes: [setup(forMember())] })];
        await open();
        await review();
        expect(box('statuses:1').element.checked).toBe(false);
        expect(box('statuses:1').element.disabled).toBe(true);
        expect(wrapper.find('[data-test="intent-pick-locked"]').text()).toBe('An owner or admin approves this part');
        await approveParts();
        expect(sent()).toEqual([['p1/approve', { parts: { 0: { statuses: [0], lists: [0], tasks: [0] } } }]]);
    });

    it('sends only the parts that stayed ticked, with what each one needs', async () => {
        serverProposals = [proposal('p1')];
        await open();
        await review();
        await box('lists:0').trigger('change');
        expect(box('tasks:0').element.checked).toBe(false);
        await approveParts();
        expect(sent()).toEqual([['p1/approve', { parts: { 0: { statuses: [0, 1], lists: [], tasks: [] } } }]]);
    });

    it('is approved as one while nothing is locked and every part is ticked', async () => {
        serverProposals = [proposal('p1'), proposal('p2', { changes: [moveTask] })];
        await open();
        await review();
        await approveParts();
        expect(sent()).toEqual([['p1/approve', {}]]);
        expect(wrapper.findAll('[data-test="waiting-row"]')).toHaveLength(1);
        expect(toast.info).not.toHaveBeenCalled();
    });

    it('says what stays waiting and reads the queue again, where the waiting part is a row of its own', async () => {
        serverProposals = [proposal('p1', { changes: [setup(forMember())] })];
        approveAnswer = { applied: [{ ok: true }], left: { waiting: ['p9'], retry: [] } };
        await open();
        await review();
        serverProposals = [proposal('p9', { locked: true, lockedWhy: 'not_this_plan' })];
        const reads = () => apiRequest.mock.calls.filter(([type, url]) => type === 'get' && url.includes('/agents/proposals')).length;
        const before = reads();
        await approveParts();
        expect(toast.info).toHaveBeenCalledWith('What you may not approve stays waiting for someone who may.', expect.anything());
        expect(reads()).toBe(before + 1);
    });
});

describe('a waiting proposal that is not a plan, on Home', () => {
    it('is approved from its row as before, whole', async () => {
        serverProposals = [proposal('p1', { changes: [moveTask] })];
        await open();
        expect(row().find('[data-test="waiting-review"]').exists()).toBe(false);
        await row().find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(sent()).toEqual([['p1/approve', {}]]);
    });

    it('is approved whole when its card has no part to choose', async () => {
        serverProposals = [proposal('p1', { changes: [setup()] })];
        await open();
        expect(row().find('[data-test="waiting-review"]').exists()).toBe(false);
        await row().find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(sent()).toEqual([['p1/approve', {}]]);
    });
});
