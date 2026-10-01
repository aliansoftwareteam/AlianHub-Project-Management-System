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
const BULK = '/api/v2/timesheet-approval/bulk-review';

const timesheet = (n, name) => ({
    _id: `t${n}`, userId: `u${n}`, userName: name, submittedAt: `2026-09-2${n}T10:00:00.000Z`, periodStart: '2026-09-14',
    totalMinutes: 2400, billableMinutes: 2000, nonBillableMinutes: 400, overMinutes: 0
});
const SHEETS = [timesheet(1, 'Dana Reed'), timesheet(2, 'Sam Ali'), timesheet(3, 'Kim Park')];
const leaveRow = { _id: 'l1', userId: 'u9', userName: 'Lee Wong', type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-02', totalDays: 2, createdAt: '2026-09-20T10:00:00.000Z' };
const proposal = { _id: 'p1', agentName: 'Daily PM', what: 'Move two tasks', why: 'Blocked', changes: [], status: 'pending', createdAt: '2026-09-19T10:00:00.000Z' };

const reviewed = (outcome) => (ids) => ids.map((id) => ({ id, outcome }));

const respond = ({ results = reviewed('approved'), bulkFails = false } = {}) => (type, url, data) => {
    const u = String(url);
    if (type === 'post' && u === BULK) {
        if (bulkFails) return Promise.reject({ response: { status: 500 } });
        const list = results(data.ids);
        const counts = { approved: 0, sent_back: 0, skipped: 0 };
        list.forEach((r) => { counts[r.outcome] += 1; });
        return Promise.resolve({ data: { status: true, data: { results: list, counts } } });
    }
    if (type === 'post') return Promise.resolve({ data: { status: true, data: {} } });
    if (u.startsWith('/api/v2/agents/proposals')) return Promise.resolve({ data: { status: true, data: [proposal] } });
    if (u.includes('/timesheet-approval/queue')) return Promise.resolve({ data: { status: true, data: SHEETS } });
    if (u.includes('/pto') && u.includes('status=pending')) return Promise.resolve({ data: { status: true, data: [leaveRow] } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

const store = () => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } }
});

const open = async (opts) => {
    apiRequest.mockImplementation(respond(opts));
    const wrapper = mount(Approvals, { global: { plugins: [store()], mocks: { $t: echo } }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};

const rowChecks = (wrapper) => wrapper.findAll('[data-test="ts-select"]');
const selectAll = (wrapper) => wrapper.find('[data-test="ts-select-all"]');
const bar = (wrapper) => wrapper.find('[data-test="ts-bulk-bar"]');
const bulkPosts = () => apiRequest.mock.calls.filter(([type, url]) => type === 'post' && url === BULK);
const cardTitles = (wrapper) => wrapper.findAll('.ap__card .ap__title').map((n) => n.text());

describe('Approvals — review several timesheets at once', () => {
    beforeEach(() => { apiRequest.mockReset(); document.body.innerHTML = ''; });

    it('gives every timesheet card a labelled checkbox, and none to leave or agent cards', async () => {
        const wrapper = await open();
        expect(wrapper.findAll('.ap__card')).toHaveLength(5);
        const checks = rowChecks(wrapper);
        expect(checks).toHaveLength(3);
        checks.forEach((c) => {
            expect(c.element.tagName).toBe('INPUT');
            expect(c.attributes('type')).toBe('checkbox');
        });
        expect(checks.map((c) => c.attributes('aria-label'))).toEqual([
            'Time.bulk_select_one {"name":"Dana Reed"}',
            'Time.bulk_select_one {"name":"Sam Ali"}',
            'Time.bulk_select_one {"name":"Kim Park"}',
        ]);
    });

    it('shows no bar until something is selected, then says how many are', async () => {
        const wrapper = await open();
        expect(bar(wrapper).exists()).toBe(false);
        await rowChecks(wrapper)[1].setValue(true);
        expect(bar(wrapper).exists()).toBe(true);
        expect(bar(wrapper).text()).toContain('Time.bulk_selected {"n":1}');
        await rowChecks(wrapper)[1].setValue(false);
        expect(bar(wrapper).exists()).toBe(false);
    });

    it('select all checks every timesheet on the page and clears them again', async () => {
        const wrapper = await open();
        const all = selectAll(wrapper);
        expect(all.attributes('type')).toBe('checkbox');
        expect(wrapper.find(`label[for="${all.attributes('id')}"]`).text()).toBe('Time.bulk_select_all');

        await all.setValue(true);
        expect(rowChecks(wrapper).every((c) => c.element.checked)).toBe(true);
        expect(bar(wrapper).text()).toContain('Time.bulk_selected {"n":3}');

        await rowChecks(wrapper)[0].setValue(false);
        expect(selectAll(wrapper).element.checked).toBe(false);
        expect(selectAll(wrapper).element.indeterminate).toBe(true);

        await selectAll(wrapper).setValue(true);
        await selectAll(wrapper).setValue(false);
        expect(rowChecks(wrapper).some((c) => c.element.checked)).toBe(false);
    });

    it('offers no select all where no timesheet is listed', async () => {
        const wrapper = await open();
        await wrapper.findAll('.tv-tab').find((b) => b.text() === 'Time.filter_leave').trigger('click');
        expect(selectAll(wrapper).exists()).toBe(false);
        expect(rowChecks(wrapper)).toHaveLength(0);
    });

    it('Approve sends the selection in one request, removes the approved cards and says how many', async () => {
        const wrapper = await open();
        await rowChecks(wrapper)[0].setValue(true);
        await rowChecks(wrapper)[2].setValue(true);
        await bar(wrapper).find('[data-test="ts-bulk-approve"]').trigger('click');
        await flushPromises();

        expect(bulkPosts()).toEqual([['post', BULK, { ids: ['t1', 't3'], action: 'approve' }]]);
        expect(cardTitles(wrapper).filter((x) => x.startsWith('Time.ts_card_title'))).toEqual(['Time.ts_card_title {"name":"Sam Ali"}']);
        expect(wrapper.find('[role="status"]').text()).toBe('Time.bulk_approved_n {"n":2}');
        expect(bar(wrapper).exists()).toBe(false);
    });

    it('reports skipped timesheets with their reason and drops the ones no longer waiting', async () => {
        const results = () => [
            { id: 't1', outcome: 'approved' },
            { id: 't2', outcome: 'skipped', reason: 'already_reviewed' },
            { id: 't3', outcome: 'skipped', reason: 'not_allowed' },
        ];
        const wrapper = await open({ results });
        await selectAll(wrapper).setValue(true);
        await bar(wrapper).find('[data-test="ts-bulk-approve"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="status"]').text()).toBe([
            'Time.bulk_approved_n {"n":1}',
            'Time.bulk_skipped_n {"n":1,"reason":"Time.bulk_reason_already_reviewed"}',
            'Time.bulk_skipped_n {"n":1,"reason":"Time.bulk_reason_not_allowed"}',
        ].join(', '));
        expect(cardTitles(wrapper).filter((x) => x.startsWith('Time.ts_card_title'))).toEqual(['Time.ts_card_title {"name":"Kim Park"}']);
    });

    it('Send back asks for one note and sends it with the whole selection', async () => {
        const wrapper = await open({ results: reviewed('sent_back') });
        await selectAll(wrapper).setValue(true);
        await bar(wrapper).find('[data-test="ts-bulk-send-back"]').trigger('click');

        const note = bar(wrapper).find('[data-test="ts-bulk-note"]');
        expect(note.attributes('aria-label')).toBe('Time.bulk_note_label');
        expect(document.activeElement).toBe(note.element);

        await bar(wrapper).find('[data-test="ts-bulk-confirm-send-back"]').trigger('click');
        await flushPromises();
        expect(bulkPosts()).toHaveLength(0);
        expect(bar(wrapper).text()).toContain('Time.bulk_note_required');

        await note.setValue('  Friday is missing ');
        await bar(wrapper).find('[data-test="ts-bulk-confirm-send-back"]').trigger('click');
        await flushPromises();

        expect(bulkPosts()).toEqual([['post', BULK, { ids: ['t1', 't2', 't3'], action: 'reject', reason: 'Friday is missing' }]]);
        expect(wrapper.find('[role="status"]').text()).toBe('Time.bulk_sent_back_n {"n":3}');
        expect(rowChecks(wrapper)).toHaveLength(0);
    });

    it('keeps the cards and the selection when the request fails', async () => {
        const wrapper = await open({ bulkFails: true });
        await selectAll(wrapper).setValue(true);
        await bar(wrapper).find('[data-test="ts-bulk-approve"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('.tv-error').text()).toBe('Time.action_failed');
        expect(rowChecks(wrapper)).toHaveLength(3);
        expect(bar(wrapper).text()).toContain('Time.bulk_selected {"n":3}');
    });

    it('leaves a timesheet that left the queue out of the next request', async () => {
        const wrapper = await open();
        await selectAll(wrapper).setValue(true);
        const firstCard = wrapper.findAll('.ap__card').find((c) => c.text().includes('Dana Reed'));
        await firstCard.find('.ah-btn--primary').trigger('click');
        await flushPromises();
        await bar(wrapper).find('[data-test="ts-bulk-approve"]').trigger('click');
        await flushPromises();

        expect(bulkPosts()[0][2]).toEqual({ ids: ['t2', 't3'], action: 'approve' });
    });
});
