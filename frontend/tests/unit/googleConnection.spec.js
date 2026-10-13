import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    route: { query: {}, params: { cid: 'c1' } },
    router: { replace: vi.fn() },
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import GoogleConnection from '@/views/Integrations/GoogleConnection.vue';
import ConnectionsPage from '@/views/Integrations/ConnectionsPage.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors/google';
const G = 'google_calendar';
const CONSENT = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';
const CONNECTED_AT = '2026-10-01T09:00:00.000Z';
const MAYA = '6f0000000000000000000a03';

const storeFor = (roleType) => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
    users: { namespaced: true, getters: { users: () => [{ _id: MAYA, Employee_Name: 'Maya Shah' }] } },
} });

const mineOf = (over = {}) => ({
    connector: G, on: true, problems: [], connected: true, status: 'connected', account: { email: 'me@example.test' },
    scopes: ['openid'], connectedAt: CONNECTED_AT, lastUsedAt: null, brokenReason: '', brokenAt: null, ...over,
});
const notConnected = () => mineOf({ connected: false, status: null, account: null, scopes: [], connectedAt: null });
const memberRow = (over = {}) => ({ userId: MAYA, connector: G, status: 'connected', scopes: ['openid'], connectedAt: CONNECTED_AT, lastUsedAt: null, brokenAt: null, ...over });

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusal = (statusText) => Promise.reject({ response: { data: { status: false, statusText } } });

const serve = ({ mine = [mineOf()], members = [], answers = {} } = {}) => {
    apiRequest.mockImplementation((method, url) => {
        const key = `${method} ${url.slice(BASE.length)}`;
        if (answers[key]) return answers[key]();
        if (key === 'get /mine') return ok({ connections: mine });
        if (key === 'get /members') return ok({ connections: members });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const open = async ({ roleType = 3, query = {}, navigate = vi.fn(), ...served } = {}) => {
    route.query = query;
    serve(served);
    const wrapper = mount(GoogleConnection, { props: { navigate }, global: { plugins: [storeFor(roleType)], mocks: { $t: t } } });
    await flushPromises();
    return { wrapper, navigate };
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method).map(([, url, body]) => [url.slice(BASE.length), body]);

beforeEach(() => {
    apiRequest.mockReset();
    router.replace.mockReset();
    router.replace.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('my Google connection', () => {
    it('offers to connect while there is none, and goes to the address the server answers', async () => {
        const { wrapper, navigate } = await open({ mine: [notConnected()], answers: { [`post /${G}/connect`]: () => ok({ url: CONSENT }) } });
        expect(wrapper.find('[data-test="google-state"]').text()).toBe(t('GoogleConnection.not_connected'));
        expect(wrapper.find('[data-test="google-connect"]').text()).toBe(t('GoogleConnection.connect'));
        expect(wrapper.find('[data-test="google-disconnect"]').exists()).toBe(false);
        await wrapper.find('[data-test="google-connect"]').trigger('click');
        await flushPromises();
        expect(callsTo('post')).toEqual([[`/${G}/connect`, undefined]]);
        expect(navigate).toHaveBeenCalledWith(CONSENT);
    });

    it('goes nowhere when the answer is not Google\'s consent address', async () => {
        const { wrapper, navigate } = await open({ mine: [notConnected()], answers: { [`post /${G}/connect`]: () => ok({ url: 'https://accounts.google.com.evil.example/o/oauth2' }) } });
        await wrapper.find('[data-test="google-connect"]').trigger('click');
        await flushPromises();
        expect(navigate).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="google-error"]').text()).toBe(t('GoogleConnection.failed'));
    });

    it('says what the server refused', async () => {
        const { wrapper, navigate } = await open({ mine: [notConnected()], answers: { [`post /${G}/connect`]: () => refusal('APIURL is not set on the server.') } });
        await wrapper.find('[data-test="google-connect"]').trigger('click');
        await flushPromises();
        expect(navigate).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="google-error"]').text()).toBe('APIURL is not set on the server.');
    });

    it('shows the account, the date and the state of a connection, with Reconnect and Disconnect', async () => {
        const { wrapper } = await open();
        const state = wrapper.find('[data-test="google-state"]').text();
        expect(state).toContain(t('GoogleConnection.connected_as', { email: 'me@example.test' }));
        expect(state).toContain(t('GoogleConnection.connected_on', { when: new Date(CONNECTED_AT).toLocaleString() }));
        expect(wrapper.find('[data-test="google-connect"]').text()).toBe(t('GoogleConnection.reconnect'));
        expect(wrapper.find('[data-test="google-disconnect"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="google-broken"]').exists()).toBe(false);
    });

    it('says a connection Google stopped accepting needs reconnecting', async () => {
        const { wrapper } = await open({ mine: [mineOf({ status: 'broken', brokenReason: 'invalid_grant', brokenAt: CONNECTED_AT })] });
        expect(wrapper.find('[data-test="google-broken"]').text()).toBe(t('GoogleConnection.state_broken', { when: new Date(CONNECTED_AT).toLocaleString() }));
        expect(wrapper.find('[data-test="google-connect"]').text()).toBe(t('GoogleConnection.reconnect'));
    });

    it('disconnects after asking, and reads the state again', async () => {
        const { wrapper } = await open({ answers: { [`delete /${G}`]: () => ok({}) } });
        serve({ mine: [notConnected()], answers: { [`delete /${G}`]: () => ok({}) } });
        await wrapper.find('[data-test="google-disconnect"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('GoogleConnection.confirm_disconnect'));
        expect(callsTo('delete')).toEqual([[`/${G}`, undefined]]);
        expect(wrapper.find('[data-test="google-state"]').text()).toBe(t('GoogleConnection.not_connected'));
    });

    it('does not disconnect when the question is declined', async () => {
        window.confirm.mockReturnValue(false);
        const { wrapper } = await open();
        await wrapper.find('[data-test="google-disconnect"]').trigger('click');
        await flushPromises();
        expect(callsTo('delete')).toEqual([]);
    });
});

describe('coming back from Google', () => {
    it('takes the code out of the address first, then completes under this session', async () => {
        const order = [];
        router.replace.mockImplementation(async (to) => { order.push(['replace', to]); });
        route.query = { connector: G, state: 'the-state', code: 'the-code', tab: 'apps' };
        serve({ answers: { [`post /${G}/complete`]: () => { order.push(['complete']); return ok(mineOf()); } } });
        const wrapper = mount(GoogleConnection, { props: { navigate: vi.fn() }, global: { plugins: [storeFor(3)], mocks: { $t: t } } });
        await flushPromises();
        expect(order).toEqual([['replace', { query: { tab: 'apps' } }], ['complete']]);
        expect(callsTo('post')).toEqual([[`/${G}/complete`, { state: 'the-state', code: 'the-code' }]]);
        expect(wrapper.find('[data-test="google-notice"]').text()).toBe(t('GoogleConnection.connected_now'));
        expect(wrapper.find('[data-test="google-notice"]').classes()).toContain('gcn__notice--ok');
        expect(wrapper.html()).not.toContain('the-code');
    });

    it('shows why the server refused to complete it', async () => {
        const { wrapper } = await open({ query: { connector: G, state: 's', code: 'c' }, mine: [notConnected()], answers: { [`post /${G}/complete`]: () => refusal('This connection attempt is no longer valid.') } });
        expect(wrapper.find('[data-test="google-notice"]').text()).toBe('This connection attempt is no longer valid.');
        expect(wrapper.find('[data-test="google-notice"]').classes()).not.toContain('gcn__notice--ok');
        expect(wrapper.find('[data-test="google-state"]').text()).toBe(t('GoogleConnection.not_connected'));
    });

    it.each([
        ['access_denied', 'GoogleConnection.error_access_denied'],
        ['state', 'GoogleConnection.error_state'],
        ['<b>anything else</b>', 'GoogleConnection.error_generic'],
    ])('an error return (%s) completes nothing and says so in the product\'s own words', async (reason, key) => {
        const { wrapper } = await open({ query: { connector: G, result: 'error', reason }, mine: [notConnected()] });
        expect(callsTo('post')).toEqual([]);
        expect(router.replace).toHaveBeenCalledWith({ query: {} });
        expect(wrapper.find('[data-test="google-notice"]').text()).toBe(t(key));
        expect(wrapper.html()).not.toContain('anything else');
    });

    it.each([
        ['a connector this page does not know', { connector: '../slack', state: 's', code: 'c' }],
        ['no code', { connector: G, state: 's' }],
        ['a repeated code', { connector: G, state: 's', code: ['a', 'b'] }],
    ])('with %s it sends nothing', async (label, query) => {
        await open({ query, mine: [notConnected()] });
        expect(callsTo('post')).toEqual([]);
        expect(router.replace).toHaveBeenCalledWith({ query: {} });
    });

    it('leaves the address alone when it is not a return', async () => {
        await open({ query: { tab: 'apps' } });
        expect(router.replace).not.toHaveBeenCalled();
    });
});

describe('a connector that is named but off', () => {
    it('tells an owner or admin which settings are missing, and offers no button', async () => {
        const { wrapper } = await open({ roleType: 1, mine: [{ connector: G, on: false, problems: ['google_client_missing', 'taint_routing_off'] }] });
        const off = wrapper.find('[data-test="google-off"]').text();
        expect(off).toContain(t('GoogleConnection.problem_google_client_missing'));
        expect(off).toContain(t('GoogleConnection.problem_taint_routing_off'));
        expect(wrapper.find('[data-test="google-connect"]').exists()).toBe(false);
    });

    it('tells a member only that it is not available yet', async () => {
        const { wrapper } = await open({ mine: [{ connector: G, on: false, problems: [] }] });
        expect(wrapper.find('[data-test="google-unavailable"]').text()).toBe(t('GoogleConnection.off_member'));
        expect(wrapper.find('[data-test="google-off"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="google-connect"]').exists()).toBe(false);
    });

    it('has a line for every reason the server can give', () => {
        for (const code of ['secrets_store_off', 'secrets_key_invalid', 'taint_routing_off', 'google_client_missing']) {
            expect(en.GoogleConnection[`problem_${code}`]).toBeTruthy();
        }
    });
});

describe('what an owner or admin sees of the members\' connections', () => {
    it('a member does not ask for the list and sees no such section', async () => {
        const { wrapper } = await open({ roleType: 3, members: [memberRow()] });
        expect(callsTo('get').map(([path]) => path)).toEqual(['/mine']);
        expect(wrapper.find('[data-test="google-members"]').exists()).toBe(false);
    });

    it.each([1, 2])('role %s sees who is connected by name, and can end a connection after being asked', async (roleType) => {
        const { wrapper } = await open({ roleType, members: [memberRow()], answers: { [`delete /${G}/members/${MAYA}`]: () => ok({ connections: [] }) } });
        const row = wrapper.find(`[data-test="google-member-${MAYA}"]`);
        expect(row.text()).toContain('Maya Shah');
        expect(row.text()).toContain(t('GoogleConnection.name_google_calendar'));
        expect(row.find('[data-test="google-member-disconnect"]').attributes('aria-label')).toBe(t('GoogleConnection.member_disconnect_label', { name: 'Maya Shah' }));
        await row.find('[data-test="google-member-disconnect"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('GoogleConnection.confirm_member_disconnect', { name: 'Maya Shah' }));
        expect(callsTo('delete')).toEqual([[`/${G}/members/${MAYA}`, undefined]]);
        expect(wrapper.find(`[data-test="google-member-${MAYA}"]`).exists()).toBe(false);
        expect(wrapper.find('[data-test="google-members-none"]').text()).toBe(t('GoogleConnection.members_none'));
    });

    it('names a member the page does not know by the end of their id, and marks a broken connection', async () => {
        const { wrapper } = await open({ roleType: 1, members: [memberRow({ userId: '6f0000000000000000abcdef', status: 'broken' })] });
        const row = wrapper.find('[data-test="google-member-6f0000000000000000abcdef"]');
        expect(row.text()).toContain(t('GoogleConnection.member_unknown', { id: 'abcdef' }));
        expect(row.text()).toContain(t('GoogleConnection.member_broken'));
    });

    it('shows no section when the list is refused', async () => {
        const { wrapper } = await open({ roleType: 1, answers: { 'get /members': () => refusal('Only an owner or admin.') } });
        expect(wrapper.find('[data-test="google-members"]').exists()).toBe(false);
    });
});

describe('the Connections page', () => {
    const openPage = async (catalogue) => {
        route.query = {};
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/catalog')) return Promise.resolve({ data: catalogue });
            if (url.startsWith(BASE)) return ok({ connections: [] });
            return Promise.resolve({ data: { status: true, data: [] } });
        });
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
        const wrapper = mount(ConnectionsPage, { global: { plugins: [storeFor(3)], mocks: { $t: t }, stubs: { 'router-link': true } } });
        await flushPromises();
        return wrapper;
    };

    it('has no "My connections" section while the server does not name the connector', async () => {
        const wrapper = await openPage({ status: true, data: [], connectors: ['slack'] });
        expect(wrapper.find('[data-test="google-connection"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/connectors'))).toBe(false);
    });

    it('shows it once the server names the connector, and not on the MCP or agents tabs', async () => {
        const wrapper = await openPage({ status: true, data: [], connectors: ['slack', G] });
        expect(wrapper.find('[data-test="google-connection"]').exists()).toBe(true);
        const tabs = wrapper.findAll('.ah-tab');
        await tabs[2].trigger('click');
        expect(wrapper.find('[data-test="google-connection"]').exists()).toBe(false);
        await tabs[1].trigger('click');
        expect(wrapper.find('[data-test="google-connection"]').exists()).toBe(true);
    });
});
