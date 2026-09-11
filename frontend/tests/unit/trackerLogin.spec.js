import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('js-cookie', () => ({ default: { get: () => 'refresh.token.value' } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import TrackerLogin from '@/views/Authentication/TrackerLogin/TrackerLogin.vue';

const CODE = 'Q2l0eS1jb2RlLWZvci10aGUtdHJhY2tlci1zaWduLWlu';
const originalLocation = window.location;

describe('TrackerLogin', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    });
    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('opens the tracker with a one-time code and never the refresh token', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        mount(TrackerLogin);
        await flushPromises();

        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('post', '/api/v2/auth/tracker-code', {});
        expect(window.location.href).toBe(`myapp://authorize?client_id=user-1&code=${CODE}`);
        expect(window.location.href).not.toContain('refresh.token.value');
    });

    it('asks for a fresh code each time Continue is clicked', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = mount(TrackerLogin);
        await flushPromises();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(2);
    });

    it('shows an error and does not open the tracker when no code comes back', async () => {
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        const wrapper = mount(TrackerLogin);
        await flushPromises();
        expect(window.location.href).toBe('');
        expect(wrapper.find('[data-test="tracker-code-error"]').exists()).toBe(true);
    });
});
