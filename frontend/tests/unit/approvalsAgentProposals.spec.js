import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Approvals from '@/views/Approvals/Approvals.vue';

const OWNER = 1;
const PROPOSALS = '/api/v2/agents/proposals';

const proposal = (over = {}) => ({
    _id: 'p1',
    agentId: 'a1',
    agentName: 'Daily PM',
    what: 'Move two tasks into Sprint 4',
    why: 'Both are blocked on the API work that lands in Sprint 4.',
    changes: [{ action: 'task.move', label: 'Move task', reversible: true }],
    status: 'pending',
    createdAt: '2026-09-22T10:00:00.000Z',
    ...over
});

const timesheet = { _id: 't1', userId: 'u2', userName: 'Dana Reed', submittedAt: '2026-09-21T10:00:00.000Z', periodStart: '2026-09-14', totalMinutes: 2400, billableMinutes: 2000, nonBillableMinutes: 400, overMinutes: 0 };
const leaveRow = { _id: 'l1', userId: 'u3', userName: 'Sam Ali', type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-02', totalDays: 2, createdAt: '2026-09-20T10:00:00.000Z' };

const respond = ({ proposals = [proposal()], proposalsFail = false } = {}) => (type, url) => {
    const u = String(url);
    if (type === 'post') return Promise.resolve({ data: { status: true, data: {} } });
    if (u.startsWith(PROPOSALS)) {
        if (proposalsFail) return Promise.reject({ response: { status: 500, data: { statusText: 'boom' } } });
        return Promise.resolve({ data: { status: true, data: proposals, counts: { waiting: proposals.length } } });
    }
    if (u.includes('/timesheet-approval/queue')) return Promise.resolve({ data: { status: true, data: [timesheet] } });
    if (u.includes('/pto') && u.includes('status=pending')) return Promise.resolve({ data: { status: true, data: [leaveRow] } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

const store = () => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } }
});

const open = async (opts) => {
    apiRequest.mockImplementation(respond(opts));
    const wrapper = mount(Approvals, { global: { plugins: [store()], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const showTab = async (wrapper, labelKey) => {
    await wrapper.findAll('.tv-tab').find((b) => b.text() === labelKey).trigger('click');
    await flushPromises();
};

const agentCards = (wrapper) => wrapper.findAll('.ap__card--agent');

describe('Approvals — agent proposals', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('loads pending proposals from the agent proposals API', async () => {
        await open();
        expect(apiRequest).toHaveBeenCalledWith('get', `${PROPOSALS}?status=pending`);
    });

    it('shows a pending proposal on the AI tab instead of the empty state', async () => {
        const wrapper = await open();
        await showTab(wrapper, 'Time.filter_ai');
        const cards = agentCards(wrapper);
        expect(cards).toHaveLength(1);
        expect(cards[0].text()).toContain('Move two tasks into Sprint 4');
        expect(cards[0].text()).toContain('Daily PM');
        expect(cards[0].text()).toContain('Both are blocked on the API work');
        expect(wrapper.text()).not.toContain('Time.agent_empty');
    });

    it('includes the proposal on the All tab next to time and leave', async () => {
        const wrapper = await open();
        expect(wrapper.findAll('.ap__card')).toHaveLength(3);
        expect(agentCards(wrapper)).toHaveLength(1);
    });

    it('renders proposal text as text, not markup', async () => {
        const wrapper = await open({ proposals: [proposal({ what: '<img src=x onerror=alert(1)>' })] });
        await showTab(wrapper, 'Time.filter_ai');
        expect(agentCards(wrapper)[0].find('img').exists()).toBe(false);
        expect(agentCards(wrapper)[0].text()).toContain('<img src=x onerror=alert(1)>');
    });

    it('Approve calls the agent approve endpoint and removes the card', async () => {
        const wrapper = await open();
        await showTab(wrapper, 'Time.filter_ai');
        await agentCards(wrapper)[0].find('.ah-btn--primary').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${PROPOSALS}/p1/approve`, {});
        expect(agentCards(wrapper)).toHaveLength(0);
        expect(wrapper.text()).toContain('Time.agent_empty');
    });

    it('Reject declines through the agent decline endpoint with the reason', async () => {
        const wrapper = await open();
        await showTab(wrapper, 'Time.filter_ai');
        await agentCards(wrapper)[0].find('.tv-btn-danger-outline').trigger('click');
        await agentCards(wrapper)[0].find('input').setValue('Not this sprint');
        await agentCards(wrapper)[0].find('.ah-btn--danger').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${PROPOSALS}/p1/decline`, { reason: 'Not this sprint' });
        expect(agentCards(wrapper)).toHaveLength(0);
    });

    it('keeps the card when the server refuses the decision', async () => {
        const wrapper = await open();
        apiRequest.mockImplementation((type, url) => (type === 'post'
            ? Promise.reject({ response: { status: 403, data: { status: false, statusText: 'This proposal needs an Owner or Admin.' } } })
            : respond()(type, url)));
        await showTab(wrapper, 'Time.filter_ai');
        await agentCards(wrapper)[0].find('.ah-btn--primary').trigger('click');
        await flushPromises();
        expect(agentCards(wrapper)).toHaveLength(1);
        expect(wrapper.find('.tv-error').exists()).toBe(true);
    });

    it('a failing proposals request still renders time and leave', async () => {
        const wrapper = await open({ proposalsFail: true });
        expect(wrapper.findAll('.ap__card')).toHaveLength(2);
        expect(wrapper.text()).toContain('Dana Reed');
        expect(wrapper.text()).toContain('Sam Ali');
        expect(wrapper.text()).toContain('Time.agent_load_failed');
        await showTab(wrapper, 'Time.filter_ai');
        expect(wrapper.text()).not.toContain('Time.agent_empty');
    });
});
