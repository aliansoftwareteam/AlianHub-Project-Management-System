import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { getters } = vi.hoisted(() => ({ getters: {} }));

vi.mock('@/services', () => ({ apiRequest: vi.fn(async () => ({ data: { status: true, data: [], total: 0 } })) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));
vi.mock('@/composable', () => ({ useMoment: () => ({ changeDateFormate: (value) => String(value) }) }));

import TimeOff from '@/views/Settings/TimeOff/TimeOff.vue';

/* 2026-07-03 is a Friday and 2026-07-06 the Monday after it. */
const totalDays = async (company, from = '2026-07-03', to = '2026-07-06') => {
    getters['settings/selectedCompany'] = company;
    getters['settings/companyUserDetail'] = { roleType: 3 };
    const wrapper = mount(TimeOff);
    await flushPromises();
    const [start, end] = wrapper.findAll('input[type="date"]');
    await start.setValue(from);
    await end.setValue(to);
    const text = wrapper.find('.pto-days b').text();
    wrapper.unmount();
    return text;
};

describe('Time off request counts the company\'s working days', () => {
    it('skips Saturday and Sunday for a company that never chose a week', async () => {
        expect(await totalDays({ _id: 'company-1' })).toBe('2');
    });

    it('counts Saturday for a Monday-to-Saturday company', async () => {
        expect(await totalDays({ _id: 'company-1', workingDays: [1, 2, 3, 4, 5, 6] })).toBe('3');
    });

    it('counts Sunday and not Friday for a Sunday-to-Thursday company', async () => {
        const company = { _id: 'company-1', workingDays: [0, 1, 2, 3, 4] };
        expect(await totalDays(company, '2026-07-04', '2026-07-05')).toBe('1');
        expect(await totalDays(company, '2026-07-03', '2026-07-04')).toBe('0');
    });
});
