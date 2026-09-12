import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay, route } = vi.hoisted(() => ({
    apiRequestWithoutCompnay: vi.fn(),
    route: { query: {} }
}));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('js-cookie', () => ({ default: { get: () => 'refresh.token.value' } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import TrackerLogin from '@/views/Authentication/TrackerLogin/TrackerLogin.vue';

const CODE = 'Q2l0eS1jb2RlLWZvci10aGUtdHJhY2tlci1zaWduLWlu';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const originalLocation = window.location;

const open = async (query = {}) => {
    route.query = query;
    const wrapper = mount(TrackerLogin);
    await flushPromises();
    return wrapper;
};

describe('TrackerLogin', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        route.query = {};
        Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    });
    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('asks for no code until the person clicks Continue', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = await open();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(window.location.href).toBe('');

        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(1);
    });

    it('opens the tracker with a one-time code and never the refresh token', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = await open();
        await wrapper.find('button').trigger('click');
        await flushPromises();

        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('post', '/api/v2/auth/tracker-code', {});
        expect(window.location.href).toBe(`myapp://authorize?client_id=user-1&code=${CODE}`);
        expect(window.location.href).not.toContain('refresh.token.value');
    });

    it('binds the code to the challenge the tracker opened the page with', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = await open({ code_challenge: CHALLENGE });
        await wrapper.find('button').trigger('click');
        await flushPromises();

        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('post', '/api/v2/auth/tracker-code', { codeChallenge: CHALLENGE });
        expect(window.location.href).toBe(`myapp://authorize?client_id=user-1&code=${CODE}`);
    });

    it('asks for a fresh code each time Continue is clicked', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = await open();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(2);
    });

    it('shows an error and does not open the tracker when no code comes back', async () => {
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        const wrapper = await open();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(window.location.href).toBe('');
        expect(wrapper.find('[data-test="tracker-code-error"]').exists()).toBe(true);
    });
});
