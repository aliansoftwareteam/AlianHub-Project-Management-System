import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure } = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn() }));
vi.mock('@/services', () => ({ apiRequestWithoutSecure }));

import MaintenanceBanner from '@/views/Settings/Instance/MaintenanceBanner.vue';

const originalLocation = window.location;
const health = (maintenance) => ({ data: { status: true, maintenance } });

describe('MaintenanceBanner', () => {
    let reload;
    beforeEach(() => {
        vi.useFakeTimers();
        apiRequestWithoutSecure.mockReset();
        reload = vi.fn();
        Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
    });
    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    const mountBanner = () => mount(MaintenanceBanner, { global: { mocks: { $t: (key) => key } } });

    it('reloads the page when maintenance ends, as the banner promises', async () => {
        apiRequestWithoutSecure.mockResolvedValueOnce(health(true)).mockResolvedValueOnce(health(false));
        const wrapper = mountBanner();
        await flushPromises();
        expect(wrapper.find('.mt-banner').exists()).toBe(true);
        expect(reload).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5000);
        await flushPromises();
        expect(reload).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('never reloads a page that did not see maintenance', async () => {
        apiRequestWithoutSecure.mockResolvedValue(health(false));
        const wrapper = mountBanner();
        await flushPromises();
        await vi.advanceTimersByTimeAsync(60000);
        await flushPromises();
        expect(reload).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});
