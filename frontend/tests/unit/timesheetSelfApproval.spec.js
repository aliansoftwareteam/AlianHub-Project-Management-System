/* Task 046: an owner or admin may approve their own timesheet week, and the week says that they did. */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';

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

import en from '@/locales/en';
import Approvals from '@/views/Approvals/Approvals.vue';
import { isOwnApproval } from '@/views/Approvals/approvalAccess';

const OWNER = 1;
const sheet = (n, name) => ({
    _id: `t${n}`, userId: `u${n}`, userName: name, submittedAt: `2026-09-2${n}T10:00:00.000Z`, periodStart: '2026-09-14',
    totalMinutes: 2400, billableMinutes: 2000, nonBillableMinutes: 400, overMinutes: 0
});

const open = async (viewer) => {
    apiRequest.mockImplementation((type, url) => Promise.resolve({
        data: { status: true, data: String(url).includes('/timesheet-approval/queue') ? [sheet(1, 'Dana Reed'), sheet(2, 'Olive Owner')] : [] }
    }));
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } } });
    const wrapper = mount(Approvals, { global: { plugins: [store], mocks: { $t: echo }, provide: { $userId: ref(viewer), $companyId: ref('c1') } } });
    await flushPromises();
    return wrapper;
};

describe('an approval given by the person whose week it is', () => {
    it('is told from one given by someone else, and from a week that is no longer approved', () => {
        expect(isOwnApproval({ status: 'approved', selfApproved: true })).toBe(true);
        expect(isOwnApproval({ status: 'approved', selfApproved: false })).toBe(false);
        expect(isOwnApproval({ status: 'approved' })).toBe(false);
        expect(isOwnApproval({ status: 'submitted', selfApproved: true })).toBe(false);
        expect(isOwnApproval(null)).toBe(false);
    });

    it('is worded on the week\'s status and on last week\'s line', () => {
        const page = fs.readFileSync(path.resolve(__dirname, '../../src/views/Timesheet/UserTimeSheet/UserTimesheet.vue'), 'utf8');
        expect(page).toMatch(/isOwnApproval\(doc\) \? t\('Time\.approved_own_week', \{ name: doc\.reviewerName/);
        expect(page).toMatch(/isOwnApproval\(doc\) \? 'Time\.approved_by_own_week' : 'Time\.approved_by'/);
        expect(en.Time.approved_own_week).toBe('Approved by {name} (own week)');
        expect(en.Time.approved_by_own_week).toBe('approved by {name} (own week)');
    });
});

describe('the Approvals page', () => {
    it('marks the reviewer\'s own week in the queue, and no one else\'s', async () => {
        const wrapper = await open('u2');
        const marked = wrapper.findAll('.ap__card').filter((card) => card.find('[data-test="own-week"]').exists());

        expect(marked).toHaveLength(1);
        expect(marked[0].find('.ap__title').text()).toContain('Olive Owner');
        expect(marked[0].find('[data-test="own-week"]').text()).toBe('Time.own_week');
        expect(marked[0].find('[data-test="own-week"]').attributes('title')).toBe('Time.own_week_hint');
    });

    it('marks nothing for a reviewer with no week waiting', async () => {
        expect((await open('u7')).find('[data-test="own-week"]').exists()).toBe(false);
    });
});
