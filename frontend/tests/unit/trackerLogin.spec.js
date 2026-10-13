import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';

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

const mountPage = () => mount(TrackerLogin, { global: { stubs: { RouterLink: RouterLinkStub } } });

const open = async (query = {}) => {
    route.query = query;
    const wrapper = mountPage();
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

describe('TrackerLogin when the tracker does not open', () => {
    const openAndContinue = async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { code: CODE } } });
        const wrapper = mountPage();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        return wrapper;
    };
    const hint = (wrapper) => wrapper.find('[data-test="tracker-not-opened"]');

    beforeEach(() => {
        vi.useFakeTimers();
        apiRequestWithoutCompnay.mockReset();
        route.query = {};
        Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    });
    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
        delete document.hidden;
    });

    it('points to the tracker download after a couple of seconds', async () => {
        const wrapper = await openAndContinue();
        await vi.advanceTimersByTimeAsync(1000);
        expect(hint(wrapper).exists()).toBe(false);

        await vi.advanceTimersByTimeAsync(4000);
        expect(hint(wrapper).exists()).toBe(true);
        expect(hint(wrapper).findComponent(RouterLinkStub).props('to')).toEqual({ name: 'Time Tracking', params: { cid: 'company-1' } });
    });

    it('stays quiet when the page loses focus to the tracker', async () => {
        const wrapper = await openAndContinue();
        window.dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(5000);
        expect(hint(wrapper).exists()).toBe(false);
    });

    it('stays quiet when the page is hidden', async () => {
        const wrapper = await openAndContinue();
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(5000);
        expect(hint(wrapper).exists()).toBe(false);
    });

    it('stops waiting when the page goes away', async () => {
        const wrapper = await openAndContinue();
        expect(vi.getTimerCount()).toBe(1);
        wrapper.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('says nothing about a download when no code came back', async () => {
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        const wrapper = mountPage();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        await vi.advanceTimersByTimeAsync(5000);
        expect(hint(wrapper).exists()).toBe(false);
    });
});
