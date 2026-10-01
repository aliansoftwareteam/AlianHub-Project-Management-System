import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { flushPromises, mount } from '@vue/test-utils';

const reloadPage = vi.hoisted(() => vi.fn());
vi.mock('@/utils/reloadPage', () => ({ reloadPage }));
vi.mock('@/services', () => ({ apiRequestWithoutSecure: vi.fn(), apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn(), SESSION_EXPIRED_KEY: 'ah.sessionExpired' }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), hasRoute: () => false }), useRoute: () => ({ query: {} }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/oauth/ProviderButton.vue', () => ({ default: { name: 'ProviderButton', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import { isOnline, unreachable, away, markAway } from '@/offline';
import { readSessionUser } from '@/router/sessionCheck';
import { apiRequestWithoutSecure } from '@/services';
import { RETRY_EVERY_MS } from '@/offline/offlineRules';
import OfflineStart from '@/components/offline/OfflineStart.vue';
import Login from '@/views/Authentication/Login/Login.vue';

const source = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const setBrowserOnline = (value) => Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });

afterEach(() => vi.useRealTimers());

beforeEach(() => {
    reloadPage.mockClear();
    apiRequestWithoutSecure.mockReset();
    isOnline.value = true;
    unreachable.value = false;
    setBrowserOnline(true);
});

describe('reading the session when a page opens', () => {
    it('is signed out with no user id on this device, without asking the server', async () => {
        const fetchUser = vi.fn();
        expect(await readSessionUser(null, fetchUser)).toEqual({ user: null, unreachable: false });
        expect(fetchUser).not.toHaveBeenCalled();
    });

    it('is the user the server returns', async () => {
        const user = { _id: 'user-1' };
        expect(await readSessionUser('user-1', async () => ({ status: 200, data: user }))).toEqual({ user, unreachable: false });
    });

    it('is unknown, not signed out, when the server gives no answer', async () => {
        expect(await readSessionUser('user-1', async () => { throw networkError(); })).toEqual({ user: null, unreachable: true });
    });

    it('still fails on an answer that is an error', async () => {
        const refused = Object.assign(new Error('Request failed'), { response: { status: 500 } });
        await expect(readSessionUser('user-1', async () => { throw refused; })).rejects.toBe(refused);
    });

    it('lets the navigation through with the app marked away, and sends nobody to sign-in', () => {
        const guard = source('router/index.js');
        const branch = /if \(unreachable\) \{([\s\S]*?)\n\t\}/.exec(guard);
        expect(branch).toBeTruthy();
        expect(branch[1]).toContain('markAway()');
        expect(branch[1]).toContain('next()');
        expect(branch[1]).not.toContain('Log-in');
        expect(guard.indexOf('if (unreachable) {')).toBeLessThan(guard.indexOf("next({name: 'Log-in'"));
    });
});

describe('marking the app away', () => {
    it('reads a browser with no connection as offline', () => {
        setBrowserOnline(false);
        markAway();
        expect(isOnline.value).toBe(false);
        expect(away.value).toBe(true);
    });

    it('reads a browser with a connection as a server that does not answer', () => {
        markAway();
        expect(isOnline.value).toBe(true);
        expect(unreachable.value).toBe(true);
        expect(away.value).toBe(true);
    });
});

describe('the screen a signed-in person gets when the app opens with no connection', () => {
    let mounted = [];
    const mountScreen = () => {
        const wrapper = mount(OfflineStart, { global: { stubs: { ShellIcon: true } } });
        mounted.push(wrapper);
        return wrapper;
    };
    afterEach(() => {
        mounted.forEach((wrapper) => wrapper.unmount());
        mounted = [];
    });

    it('says the app is offline and what happens next, in place of a spinner', () => {
        const wrapper = mountScreen();
        expect(wrapper.find('.ah-state--offline').exists()).toBe(true);
        expect(wrapper.text()).toContain('Inbox.state_offline_title');
        expect(wrapper.text()).toContain('Shell.offline_start_body');
    });

    it('reloads on Retry', async () => {
        const wrapper = mountScreen();
        await wrapper.find('button').trigger('click');
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('reloads by itself once the server answers again', async () => {
        apiRequestWithoutSecure.mockResolvedValue({ status: 200, data: { status: true } });
        mountScreen();
        expect(reloadPage).not.toHaveBeenCalled();

        window.dispatchEvent(new Event('online'));
        await flushPromises();

        expect(apiRequestWithoutSecure).toHaveBeenCalledWith('get', '/version');
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('keeps asking, and does not reload, while the server gives no answer', async () => {
        vi.useFakeTimers();
        apiRequestWithoutSecure.mockRejectedValue(networkError());
        mountScreen();

        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 3);

        expect(apiRequestWithoutSecure).toHaveBeenCalledTimes(4);
        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('does not reload because the offline state cleared, which it does on a timer while the server is still down', async () => {
        isOnline.value = false;
        apiRequestWithoutSecure.mockRejectedValue(networkError());
        mountScreen();
        isOnline.value = true;
        unreachable.value = false;
        await flushPromises();
        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('does not ask while the browser has no connection, or after it has gone', async () => {
        vi.useFakeTimers();
        setBrowserOnline(false);
        const wrapper = mountScreen();
        await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 2);
        expect(apiRequestWithoutSecure).not.toHaveBeenCalled();

        setBrowserOnline(true);
        wrapper.unmount();
        mounted = [];
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 2);
        expect(apiRequestWithoutSecure).not.toHaveBeenCalled();
    });

    it('takes the place of the spinner in App.vue while the app is away', () => {
        const app = source('App.vue');
        const offline = app.indexOf('<OfflineStart v-else-if="away"');
        expect(offline).toBeGreaterThan(app.indexOf('<template v-if="shellReady">'));
        expect(offline).toBeLessThan(app.indexOf('<div v-else class="d-flex align-items-center justify-content-center lds-roller h-100dvh">'));
    });
});

describe('the sign-in page with no connection', () => {
    const mountLogin = () => mount(Login, {
        global: {
            mocks: { $t: (key) => key },
            provide: { $axios: { post: vi.fn() } },
            stubs: { 'router-link': { template: '<a><slot /></a>' }, 'i18n-t': { template: '<p><slot name="email" /></p>' } },
        },
    });

    it('says so above the form', () => {
        isOnline.value = false;
        const banner = mountLogin().find('.auth__banner');
        expect(banner.exists()).toBe(true);
        expect(banner.text()).toBe('Auth.offline_sign_in');
        expect(banner.classes()).toContain('auth__banner--warn');
    });

    it('shows no banner with a connection', () => {
        expect(mountLogin().find('.auth__banner').exists()).toBe(false);
    });

    it('takes the notice away when the connection is back', async () => {
        isOnline.value = false;
        const wrapper = mountLogin();
        isOnline.value = true;
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.auth__banner').exists()).toBe(false);
    });
});
