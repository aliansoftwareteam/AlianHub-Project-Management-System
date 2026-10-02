import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import WaitingOnYouCard from '@/components/molecules/Home/WaitingOnYouCard.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const blank = { render: () => null };

const proposal = (id, over = {}) => ({ _id: id, status: 'pending', agentName: 'Reviewer', what: `Change ${id}`, createdAt: '2026-09-28T09:00:00Z', ...over });
const approval = (id, over = {}) => ({ _id: id, runId: `run-${id}`, stepId: `step-${id}`, status: 'pending', title: `Approve ${id}`, canDecide: true, ...over });

let serverProposals;
let serverApprovals;

const answer = (type, url) => {
    if (type === 'get' && url.includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: serverProposals, counts: { waiting: serverProposals.length } } });
    if (type === 'get' && url.includes('/workflows/approvals')) return Promise.resolve({ data: { status: true, data: serverApprovals } });
    if (type === 'post' && url.includes('/approve')) return Promise.resolve({ data: { status: true, data: {} } });
    if (type === 'post' && url.includes('/decide')) return Promise.resolve({ data: { status: true, data: { approval: null } } });
    return Promise.resolve({ data: { status: false } });
};

const open = async ({ roleType = 1 } = {}) => {
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
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
    const wrapper = mount(WaitingOnYouCard, { global: { plugins: [store, router] } });
    await flushPromises();
    return { wrapper, router };
};

const rows = (wrapper) => wrapper.findAll('[data-test="waiting-row"]');

describe('Waiting on you (Home card)', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(answer);
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON });
        serverProposals = [];
        serverApprovals = [];
    });

    it('shows the count and the three most recent things to decide, with a way to the Inbox tab that holds the proposals', async () => {
        serverProposals = [proposal('p1'), proposal('p2'), proposal('p3')];
        serverApprovals = [approval('a1'), approval('a2')];
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="waiting-card"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="waiting-count"]').text()).toBe('5');
        expect(rows(wrapper)).toHaveLength(3);
        const link = wrapper.find('[data-test="waiting-inbox"]');
        expect(link.attributes('href')).toBe('/company-1/inbox?tab=approval');
        expect(link.text()).toBe('Home.waiting_open_inbox');
    });

    it('keeps the bottom link on the AI Inbox when only workflow steps wait', async () => {
        serverApprovals = [approval('a1')];
        const { wrapper } = await open();
        const link = wrapper.find('[data-test="waiting-inbox"]');
        expect(link.attributes('href')).toBe('/company-1/ai/inbox');
        expect(link.text()).toBe('Inbox.open_ai_inbox');
    });

    it('approves a proposal through the agent API and drops the row', async () => {
        serverProposals = [proposal('p1'), proposal('p2')];
        const { wrapper } = await open();
        await rows(wrapper)[0].find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/proposals/p1/approve', {});
        expect(rows(wrapper)).toHaveLength(1);
        expect(wrapper.find('[data-test="waiting-count"]').text()).toBe('1');
    });

    it('approves a workflow step through the workflow API', async () => {
        serverApprovals = [approval('a1')];
        const { wrapper } = await open();
        await rows(wrapper)[0].find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', expect.stringContaining('/run-a1/steps/step-a1/decide'), { decision: 'approved', comment: '' });
    });

    it('opens the Inbox\'s approval tab from a proposal', async () => {
        serverProposals = [proposal('p1')];
        const { wrapper, router } = await open();
        await rows(wrapper)[0].find('[data-test="waiting-open"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('inbox');
        expect(router.currentRoute.value.query.tab).toBe('approval');
    });

    it('opens the AI Inbox from a workflow step, which the approval tab does not hold yet', async () => {
        serverApprovals = [approval('a1')];
        const { wrapper, router } = await open();
        await rows(wrapper)[0].find('[data-test="waiting-open"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('AiInbox');
    });

    it('leaves out what the caller may not decide', async () => {
        serverProposals = [proposal('p1', { gate: 'owner_admin' }), proposal('p2')];
        serverApprovals = [approval('a1', { canDecide: false })];
        const { wrapper } = await open({ roleType: 3 });
        expect(rows(wrapper)).toHaveLength(1);
        expect(wrapper.text()).toContain('Change p2');
        expect(wrapper.text()).not.toContain('Change p1');
    });

    it('says why on every line an agent proposed, and that none was given when it gave none', async () => {
        serverProposals = [proposal('p1', { why: 'The date slipped twice.' }), proposal('p2')];
        serverApprovals = [approval('a1')];
        const { wrapper } = await open();
        const whys = rows(wrapper).map((row) => row.find('[data-test="waiting-why"]'));
        expect(whys[0].text()).toContain('Ai.why');
        expect(whys[0].text()).toContain('The date slipped twice.');
        expect(whys[1].text()).toContain('Time.why_no_reason');
        expect(whys[2].exists()).toBe(false);
    });

    it('tells Home how many things it holds, and again once one is decided', async () => {
        serverProposals = [proposal('p1'), proposal('p2')];
        const { wrapper } = await open();
        expect(wrapper.emitted('count').at(-1)).toEqual([2]);
        await rows(wrapper)[0].find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(wrapper.emitted('count').at(-1)).toEqual([1]);
    });

    it('is hidden when nothing is waiting', async () => {
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="waiting-card"]').exists()).toBe(false);
    });

    it('is hidden and asks nothing when AI is off', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        serverProposals = [proposal('p1')];
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="waiting-card"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('is hidden when the queue cannot be read', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="waiting-card"]').exists()).toBe(false);
    });
});
