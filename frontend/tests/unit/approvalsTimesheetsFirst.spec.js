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
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => ({ default: { name: 'TimesheetTabs', render: () => null } }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Approvals from '@/views/Approvals/Approvals.vue';

const OWNER = 1;

const sheet = (id, name, submittedAt, over = {}) => ({
    _id: id, userId: `u-${id}`, userName: name, submittedAt, periodStart: '2026-09-14',
    totalMinutes: 2400, billableMinutes: 2000, nonBillableMinutes: 400, overMinutes: 0, ...over
});
const proposal = (id, createdAt) => ({
    _id: id, agentId: 'a1', agentName: 'Daily PM', what: `Proposal ${id}`, why: 'Because.', status: 'pending', createdAt,
    changes: [{ action: 'task.move', label: 'Move task', reversible: true }]
});
const leave = (id, name, createdAt) => ({ _id: id, userId: `u-${id}`, userName: name, type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-02', totalDays: 2, createdAt });

const open = async ({ sheets = [], proposals = [], leaves = [] }) => {
    apiRequest.mockImplementation((type, url) => {
        const u = String(url);
        if (u.includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: proposals } });
        if (u.includes('/timesheet-approval/queue')) return Promise.resolve({ data: { status: true, data: sheets } });
        if (u.includes('status=pending')) return Promise.resolve({ data: { status: true, data: leaves } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } } });
    const wrapper = mount(Approvals, { global: { plugins: [store], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const kindOf = (card) => {
    if (card.classes().includes('ap__card--agent')) return 'agent';
    return card.find('[data-test="ts-select"]').exists() ? 'timesheet' : 'leave';
};

beforeEach(() => { apiRequest.mockReset(); });

describe('Approvals — the order of the All tab', () => {
    it('puts timesheets first, then leave, then agent proposals, however old the proposals are', async () => {
        const wrapper = await open({
            proposals: Array.from({ length: 9 }, (_, i) => proposal(`p${i}`, `2026-09-0${i + 1}T08:00:00.000Z`)),
            leaves: [leave('l1', 'Sam Ali', '2026-09-10T08:00:00.000Z')],
            sheets: [sheet('t2', 'Kim Park', '2026-09-22T10:00:00.000Z'), sheet('t1', 'Dana Reed', '2026-09-21T10:00:00.000Z')]
        });

        const cards = wrapper.findAll('.ap__card');
        expect(cards.map(kindOf)).toEqual(['timesheet', 'timesheet', 'leave', ...Array(9).fill('agent')]);
    });

    it('keeps the oldest first inside each kind', async () => {
        const wrapper = await open({
            proposals: [proposal('late', '2026-09-09T08:00:00.000Z'), proposal('early', '2026-09-01T08:00:00.000Z')],
            sheets: [sheet('t2', 'Kim Park', '2026-09-22T10:00:00.000Z'), sheet('t1', 'Dana Reed', '2026-09-21T10:00:00.000Z')]
        });

        const titles = wrapper.findAll('.ap__card .ap__title').map((n) => n.text());
        expect(titles).toEqual(['Time.ts_card_title {"name":"Dana Reed"}', 'Time.ts_card_title {"name":"Kim Park"}', 'Proposal early', 'Proposal late']);
    });
});

describe('Approvals — a timesheet card after a reopening', () => {
    it('gives one week total, the sum of the billable and internal time beside it', async () => {
        const wrapper = await open({
            sheets: [sheet('t1', 'Dana Reed', '2026-09-21T10:00:00.000Z', { totalMinutes: 91, billableMinutes: 182, nonBillableMinutes: 0 })]
        });

        const card = wrapper.find('.ap__card');
        expect(card.find('.ap__sub').text()).toBe('Time.week_of {"date":"Sep 14","h":"3h 2m"}');
        expect(card.find('.ap__facts').text()).toContain('Time.billable_h {"h":"3h 2m"}');
        expect(card.text()).not.toContain('1h 31m');
    });

    it('falls back to the stored total when the row carries no split', async () => {
        const wrapper = await open({
            sheets: [{ _id: 't1', userId: 'u1', userName: 'Dana Reed', submittedAt: '2026-09-21T10:00:00.000Z', periodStart: '2026-09-14', totalMinutes: 91 }]
        });

        expect(wrapper.find('.ap__sub').text()).toBe('Time.week_of {"date":"Sep 14","h":"1h 31m"}');
    });
});
