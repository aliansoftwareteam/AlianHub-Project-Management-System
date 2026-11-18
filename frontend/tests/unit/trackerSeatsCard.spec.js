import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('vuex', () => ({
    useStore: () => ({
        getters: {
            'users/users': [{ _id: 'u1', Employee_Name: 'Zara Patel' }, { _id: 'u2', Employee_Name: 'Amit Shah' }],
            'settings/companyUsers': [{ userId: 'u3', userEmail: 'left@example.com' }],
        },
    }),
}));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/services', () => ({ apiRequest }));

import TrackerSeatsCard from '@/views/Settings/TimeTracking/TrackerSeatsCard.vue';
import en from '@/locales/en';

const mountCard = (seats) => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    return mount(TrackerSeatsCard, { props: { seats }, global: { plugins: [i18n], mocks: { $t: i18n.global.t } } });
};

describe('TrackerSeatsCard', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('shows the seats in use and who holds them, by name', () => {
        const wrapper = mountCard({ used: 3, limit: 5, holders: ['u1', 'u2', 'u3'] });
        expect(wrapper.find('[data-test="tracker-seats-used"]').text()).toBe('3 of 5 users');
        expect(wrapper.findAll('[data-test="tracker-seats-holder"]').map((row) => row.find('span').text())).toEqual(['Amit Shah', 'left@example.com', 'Zara Patel']);
    });

    it('says so when nobody holds a seat', () => {
        const wrapper = mountCard({ used: 0, limit: 5, holders: [] });
        expect(wrapper.find('[data-test="tracker-seats-empty"]').text()).toBe('Nobody holds a tracker seat yet.');
    });

    it('gives a seat back and tells the page to reload', async () => {
        apiRequest.mockResolvedValue({ data: { status: true } });
        const wrapper = mountCard({ used: 1, limit: 5, holders: ['u1'] });
        await wrapper.find('[data-test="tracker-seats-release"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/manageTrackerUserPermission', { DataObj: { ops: false, data: { status: 2, userId: 'u1' } } });
        expect(toast.success).toHaveBeenCalledWith("Zara Patel's tracker seat is free again.", expect.anything());
        expect(wrapper.emitted('released')).toEqual([['u1']]);
    });

    it('shows the server message when the seat cannot be given back', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, message: 'That member is not part of this workspace.' } });
        const wrapper = mountCard({ used: 1, limit: 5, holders: ['u1'] });
        await wrapper.find('[data-test="tracker-seats-release"]').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('That member is not part of this workspace.', expect.anything());
        expect(wrapper.emitted('released')).toBeUndefined();
    });
});
