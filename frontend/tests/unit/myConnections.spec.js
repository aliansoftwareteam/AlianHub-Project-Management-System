import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {}, params: { cid: 'c1' } },
    router: { replace: vi.fn() },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));

import MyConnections from '@/views/Integrations/MyConnections.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusal = (statusText) => Promise.reject({ response: { data: { status: false, statusText } } });

const listOf = (over = {}) => ({
    providers: [{ provider: 'google', products: ['calendar', 'meet'] }],
    connections: [],
    ...over,
});

const serve = ({ list = listOf(), answers = {} } = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        const key = `${method} ${url.slice(BASE.length)}`;
        if (answers[key]) return answers[key](body);
        if (key === 'get ') return ok(list);
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const open = async ({ query = {}, ...served } = {}) => {
    route.query = query;
    serve(served);
    const wrapper = mount(MyConnections, { global: { mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method).map(([, url, body]) => [url.slice(BASE.length), body]);

beforeEach(() => {
    apiRequest.mockReset();
    router.replace.mockReset();
    router.replace.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('coming back from a connector', () => {
    it('completes the generic return under this session and takes the keys out of the address', async () => {
        const wrapper = await open({
            query: { connector: 'google', state: 'the-state', code: 'the-code', tab: 'apps' },
            answers: { 'post /google/complete': () => ok({}) },
        });
        expect(callsTo('post')).toEqual([['/google/complete', { state: 'the-state', code: 'the-code' }]]);
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'apps' } });
        expect(wrapper.find('[data-test="mc-notice"]').text()).toBe(t('Connectors.conn.return_ok', { provider: 'Google' }));
        expect(wrapper.html()).not.toContain('the-code');
    });

    it('says in the locale\'s words when the server refuses to complete it', async () => {
        const wrapper = await open({
            query: { connector: 'google', state: 's', code: 'c' },
            answers: { 'post /google/complete': () => refusal('This connection attempt is no longer valid.') },
        });
        expect(wrapper.find('[data-test="mc-notice"]').text()).toBe('This connection attempt is no longer valid.');
    });

    it('shows an error return without completing anything', async () => {
        const wrapper = await open({ query: { connector: 'google', result: 'error' } });
        expect(callsTo('post')).toEqual([]);
        expect(wrapper.find('[data-test="mc-notice"]').text()).toBe(t('Connectors.conn.return_error', { provider: 'Google' }));
        expect(router.replace).toHaveBeenCalled();
    });

    it.each(['access_denied', 'consent_required'])('names the admin route when the provider answers %s', async (reason) => {
        const wrapper = await open({ query: { connector: 'outlook', result: 'error', reason } });
        expect(callsTo('post')).toEqual([]);
        expect(wrapper.find('[data-test="mc-notice"]').text()).toBe(t('Connectors.conn.return_consent', { provider: 'Outlook' }));
        expect(router.replace).toHaveBeenCalled();
    });

    it('leaves the address alone when it is not a return', async () => {
        await open({ query: { tab: 'apps' } });
        expect(router.replace).not.toHaveBeenCalled();
    });
});

describe('my own connections', () => {
    it('offers to connect an un-connected provider and goes to the address the server answers', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        const wrapper = await open({ answers: { 'post /google/connect': () => ok({ url: 'https://accounts.google.com/o/oauth2' }) } });
        expect(wrapper.find('[data-test="mc-row-google"]').text()).toContain('Google');
        await wrapper.find('[data-test="mc-google-connect"]').trigger('click');
        await flushPromises();
        expect(callsTo('post')).toEqual([['/google/connect', { products: ['calendar', 'meet'] }]]);
        expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2');
    });

    it('disconnects a connection after asking, then reads the list again', async () => {
        const connected = listOf({ connections: [{ provider: 'google', connected: true, status: 'connected', products: ['calendar'], connectionId: 'x1', scopes: [] }] });
        const wrapper = await open({ list: connected, answers: { 'delete /connections/x1': () => ok({}) } });
        serve({ answers: { 'delete /connections/x1': () => ok({}) } });
        await wrapper.find('[data-test="mc-google-disconnect"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('Connectors.conn.confirm_disconnect', { provider: 'Google' }));
        expect(callsTo('delete')).toEqual([['/connections/x1', undefined]]);
    });

    it('says in the locale\'s words when the list cannot be loaded', async () => {
        const wrapper = await open({ answers: { 'get ': () => refusal('Nope.') } });
        expect(wrapper.find('[data-test="mc-load-error"]').text()).toBe('Nope.');
    });
});
