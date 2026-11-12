import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { DOMWrapper, config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router, goToConsent } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {}, params: { cid: 'c1' } },
    router: { replace: vi.fn() },
    goToConsent: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Integrations/GoogleConnection.vue', () => ({ default: { name: 'GoogleConnection', render: () => h('div', { 'data-test': 'google-connection' }) } }));
vi.mock('@/views/Integrations/connectorApi', async (original) => ({ ...(await original()), goToConsent }));

import ConnectorsTab from '@/views/Integrations/ConnectorsTab.vue';
import {
    ALL_CATEGORIES, asksBeforeConnect, categoryOf, connectorRows, filterBrowse, initialsOf, needsAttention, sortMine, toolsOffAfter,
} from '@/views/Integrations/connectorCatalog';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors';
const TOKEN = 'ghp_a-secret-the-page-must-never-show';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText, code) => Promise.resolve({ data: { status: false, statusText, code } });

const connection = (provider, over = {}) => ({
    provider, connectionId: `conn-${provider}`, connected: true, status: 'connected', account: { label: `maya@${provider}.test` },
    signIn: 'registered_app', products: [], scopes: [], toolsOff: [], connectedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null, ...over,
});

const LIST = {
    providers: [
        { provider: 'google', products: ['calendar', 'meet', 'drive'], signIn: ['oauth'] },
        { provider: 'github', products: ['repos'], signIn: ['oauth', 'token'] },
        { provider: 'notion', products: ['workspace'], signIn: ['oauth'] },
        { provider: 'slack', products: ['messages'], signIn: ['oauth'] },
        { provider: 'hubspot', products: ['crm'], signIn: ['oauth'] },
    ],
    connections: [
        connection('google', { products: ['calendar'] }),
        connection('slack', { status: 'broken' }),
        { provider: 'github', connectionId: null, connected: false },
    ],
    unavailable: [{ provider: 'canva' }],
};

const GOOGLE_TOOLS = [
    { key: 'google.calendar.events.list', label: 'Connectors.tool.googleCalendarEventsList', kind: 'read', on: true },
    { key: 'google.calendar.events.create', label: 'Connectors.tool.googleCalendarEventsCreate', kind: 'write', on: true },
    { key: 'google.drive.files.read', label: 'Connectors.tool.googleDriveFilesRead', kind: 'read', on: false },
];

const serve = (answers = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        const key = `${method} ${url.slice(BASE.length)}`;
        if (answers[key]) return answers[key](body);
        if (key === 'get ') return ok(LIST);
        if (key === 'get /google/tools') return ok({ tools: GOOGLE_TOOLS });
        if (key === 'get /servers') return ok({ servers: [], mayAdd: false });
        if (key.startsWith('get /admin/tools/')) return ok({ tools: [] });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const mounted = [];

/* The dialog and the panel teleport to <body>, so the page is read there; the component answers for its events. */
const open = async ({ props = {}, query = {}, answers = {} } = {}) => {
    route.query = query;
    serve(answers);
    const component = mount(ConnectorsTab, { props: { available: true, ...props }, global: { mocks: { $t: t } }, attachTo: document.body });
    mounted.push(component);
    await flushPromises();
    const page = () => new DOMWrapper(document.body);
    return {
        find: (selector) => page().find(selector),
        findAll: (selector) => page().findAll(selector),
        html: () => document.body.innerHTML,
        emitted: (name) => component.emitted(name),
        unmount: () => { mounted.splice(mounted.indexOf(component), 1); component.unmount(); },
    };
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method).map(([, url, body]) => [url.slice(BASE.length), body]);
const cardNames = (wrapper) => wrapper.findAll('.cx-card__name').map((node) => node.text());

beforeEach(() => {
    apiRequest.mockReset();
    router.replace.mockReset();
    router.replace.mockResolvedValue(undefined);
    goToConsent.mockReset();
});

afterEach(() => {
    mounted.splice(0).forEach((component) => component.unmount());
    document.body.innerHTML = '';
});

describe('sorting and filtering the connectors', () => {
    const rows = connectorRows(LIST);
    const name = (id) => ({ google: 'Google', slack: 'Slack', github: 'GitHub', notion: 'Notion', hubspot: 'HubSpot', canva: 'Canva' }[id]);

    it('splits what the person holds from what they can still connect', () => {
        expect(rows.mine.map((row) => row.provider)).toEqual(['google', 'slack']);
        expect(rows.browse.map((row) => row.provider)).toEqual(['github', 'notion', 'hubspot']);
        expect(rows.unavailable).toEqual([{ provider: 'canva' }]);
    });

    it('puts a connection that needs attention first', () => {
        expect(sortMine(rows.mine, name).map((row) => row.provider)).toEqual(['slack', 'google']);
        expect(needsAttention(rows.mine.find((row) => row.provider === 'slack'))).toBe(true);
        expect(needsAttention({ connection: connection('x', { status: 'reauth_required' }) })).toBe(true);
        expect(needsAttention({ connection: connection('x') })).toBe(false);
    });

    it('filters by the words on the card and by category', () => {
        const words = (row) => [name(row.provider), categoryOf(row.provider)];
        expect(filterBrowse(rows.browse, { query: 'hub' }, words).map((row) => row.provider)).toEqual(['github', 'hubspot']);
        expect(filterBrowse(rows.browse, { query: '  NOTION ' }, words).map((row) => row.provider)).toEqual(['notion']);
        expect(filterBrowse(rows.browse, { category: 'sales' }, words).map((row) => row.provider)).toEqual(['hubspot']);
        expect(filterBrowse(rows.browse, { category: ALL_CATEGORIES }, words)).toHaveLength(3);
        expect(categoryOf('a-provider-added-later')).toBe('other');
    });

    it('asks first only for products to pick or a token to paste', () => {
        expect(asksBeforeConnect({ products: ['calendar', 'meet'], signIn: ['oauth'] })).toBe(true);
        expect(asksBeforeConnect({ products: ['repos'], signIn: ['token'] })).toBe(true);
        expect(asksBeforeConnect({ products: ['workspace'], signIn: ['oauth'] })).toBe(false);
    });

    it('turns one tool off or back on without touching the others', () => {
        expect(toolsOffAfter([], 'a.b.c', false)).toEqual(['a.b.c']);
        expect(toolsOffAfter(['x.y.z', 'a.b.c'], 'a.b.c', true)).toEqual(['x.y.z']);
        expect(toolsOffAfter(['a.b.c'], 'a.b.c', false)).toEqual(['a.b.c']);
    });

    it('draws initials for an app with no logo', () => {
        expect(initialsOf('Wispr Flow')).toBe('WF');
        expect(initialsOf('Notion')).toBe('N');
        expect(initialsOf('')).toBe('?');
    });
});

describe('your connectors', () => {
    it('lists the person\'s own connections, the one needing attention first with Reconnect', async () => {
        const wrapper = await open();
        const rows = wrapper.findAll('.cx-row');
        expect(rows.map((row) => row.attributes('data-test'))).toEqual(['cx-mine-slack', 'cx-mine-google']);
        expect(rows[0].find('[data-test="cx-reconnect-slack"]').exists()).toBe(true);
        expect(rows[0].text()).toContain(t('Connectors.conn.status_broken'));
        expect(rows[1].find('[data-test="cx-reconnect-google"]').exists()).toBe(false);
        expect(rows[1].find('[data-test="cx-account"]').text()).toBe('maya@google.test');
        expect(rows[1].text()).toContain(t('Connectors.conn.never_used'));
    });

    it('reconnects a single-product app straight through its sign-in', async () => {
        const wrapper = await open({ answers: { 'post /slack/connect': () => ok({ url: 'https://slack.test/consent' }) } });
        await wrapper.find('[data-test="cx-reconnect-slack"]').trigger('click');
        await flushPromises();
        expect(callsTo('post')).toEqual([['/slack/connect', { products: ['messages'] }]]);
        expect(goToConsent).toHaveBeenCalledWith('https://slack.test/consent');
    });

    it('finishes a sign-in that came back, under this session, and takes the keys out of the address', async () => {
        const wrapper = await open({
            query: { connector: 'notion', state: 'the-state', code: 'the-code', tab: 'connectors' },
            answers: { 'post /notion/complete': () => ok(connection('notion')) },
        });
        expect(callsTo('post')).toEqual([['/notion/complete', { state: 'the-state', code: 'the-code' }]]);
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'connectors' } });
        expect(wrapper.find('[data-test="cx-notice"]').text()).toBe(t('Connectors.conn.return_ok', { provider: 'Notion' }));
        expect(wrapper.html()).not.toContain('the-code');
    });

    it.each(['access_denied', 'consent_required'])('names the admin route when the provider answers %s', async (reason) => {
        const wrapper = await open({ query: { connector: 'outlook', result: 'error', reason, tab: 'connectors' } });
        expect(callsTo('post')).toEqual([]);
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'connectors' } });
        expect(wrapper.find('[data-test="cx-notice"]').text()).toBe(t('Connectors.conn.return_consent', { provider: 'Outlook' }));
    });

    it('leaves the old Google Calendar return to its own card', async () => {
        await open({ props: { legacyGoogle: true }, query: { connector: 'google_calendar', state: 's', code: 'c' } });
        expect(callsTo('post')).toEqual([]);
        expect(router.replace).not.toHaveBeenCalled();
    });
});

describe('browse', () => {
    it('shows every app not yet connected, with its line and category, and one this install cannot sign in to', async () => {
        const wrapper = await open();
        expect(cardNames(wrapper)).toEqual(['Canva', 'GitHub', 'HubSpot', 'Notion']);
        const github = wrapper.find('[data-test="cx-card-github"]');
        expect(github.text()).toContain(t('Connectors.catalog.github_line'));
        expect(github.text()).toContain(t('Connectors.catalog.category_development'));
    });

    it('narrows the cards by search and by category', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="cx-search"]').setValue('pull request');
        expect(cardNames(wrapper)).toEqual(['GitHub']);
        await wrapper.find('[data-test="cx-search"]').setValue('');
        await wrapper.find('[data-test="cx-category"]').setValue('sales');
        expect(cardNames(wrapper)).toEqual(['HubSpot']);
        await wrapper.find('[data-test="cx-search"]').setValue('nothing like this');
        expect(wrapper.find('[data-test="cx-browse-none"]').exists()).toBe(true);
    });

    it('tells a member their admin has to set an app up, and sends an admin to the Workspace tab', async () => {
        const member = await open();
        expect(member.find('[data-test="cx-why-canva"]').text()).toBe(t('Connectors.screen.setup_member', { provider: 'Canva' }));
        expect(member.find('[data-test="cx-setup-canva"]').exists()).toBe(false);
        expect(member.find('[data-test="cx-connect-canva"]').exists()).toBe(false);
        member.unmount();

        const admin = await open({ props: { privileged: true } });
        await admin.find('[data-test="cx-setup-canva"]').trigger('click');
        expect(admin.emitted('open-workspace')).toHaveLength(1);
    });

    it('goes straight to the sign-in of an app with nothing to pick', async () => {
        const wrapper = await open({ answers: { 'post /notion/connect': () => ok({ url: 'https://notion.test/consent' }) } });
        await wrapper.find('[data-test="cx-connect-notion"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="cx-signin"]').exists()).toBe(false);
        expect(callsTo('post')).toEqual([['/notion/connect', { products: ['workspace'] }]]);
        expect(goToConsent).toHaveBeenCalledWith('https://notion.test/consent');
    });

    it('shows the server\'s refusal on the card', async () => {
        const wrapper = await open({ answers: { 'post /hubspot/connect': () => refused('Your role cannot connect apps for AI.') } });
        await wrapper.find('[data-test="cx-connect-hubspot"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="cx-card-hubspot"] [role="alert"]').text()).toBe('Your role cannot connect apps for AI.');
        expect(goToConsent).not.toHaveBeenCalled();
    });

    it('offers no connector routes while the server registers none, but keeps the old Google Calendar card', async () => {
        const wrapper = await open({ props: { available: false, legacyGoogle: true } });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="google-connection"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="cx-off"]').exists()).toBe(false);
    });

    it('says nothing can be connected yet, and calls nothing, for a guest', async () => {
        const wrapper = await open({ props: { guest: true } });
        expect(wrapper.find('[data-test="cx-guest"]').exists()).toBe(true);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows the add-custom button only to someone who may add custom apps, and opens the add dialog', async () => {
        const member = await open({ props: { privileged: true } });
        expect(member.find('[data-test="cx-add-custom"]').exists()).toBe(false);
        expect(member.find('[data-test="custom-servers"]').exists()).toBe(false);
        member.unmount();
        const adder = await open({ answers: { 'get /servers': () => ok({ servers: [], mayAdd: true }) } });
        expect(adder.find('[data-test="csv-add"]').exists()).toBe(false);
        await adder.find('[data-test="cx-add-custom"]').trigger('click');
        expect(adder.find('[data-test="add-custom-connector"]').exists()).toBe(true);
    });

    it("leaves a workspace's custom apps off the catalog, for their own card to list", async () => {
        const custom = { provider: 'custom_6f01', products: ['server'], signIn: ['token'], custom: true, name: 'Team notes' };
        const wrapper = await open({ answers: { 'get ': () => ok({ ...LIST, providers: [...LIST.providers, custom] }) } });
        expect(wrapper.find('[data-test="cx-connect-custom_6f01"]').exists()).toBe(false);
        expect(connectorRows({ providers: [custom] }).browse).toEqual([]);
    });
});

describe('the sign-in dialog', () => {
    it('ticks Google\'s products and sends only the ones left ticked', async () => {
        const wrapper = await open({
            answers: {
                'get ': () => ok({ ...LIST, connections: [] }),
                'post /google/connect': () => ok({ url: 'https://accounts.google.test/consent' }),
            },
        });
        await wrapper.find('[data-test="cx-connect-google"]').trigger('click');
        const dialog = wrapper.find('[data-test="cx-signin"]');
        expect(dialog.exists()).toBe(true);
        await dialog.find('[data-test="cx-signin-product-meet"]').setValue(false);
        await dialog.find('[data-test="cx-signin-oauth"]').trigger('click');
        await flushPromises();
        expect(callsTo('post')).toEqual([['/google/connect', { products: ['calendar', 'drive'] }]]);
        expect(goToConsent).toHaveBeenCalledWith('https://accounts.google.test/consent');
    });

    it('offers both ways for an app that takes a token, posts the token and never shows it again', async () => {
        let listed = 0;
        const wrapper = await open({
            answers: {
                'get ': () => { listed += 1; return ok(LIST); },
                'post /github/token': () => ok(connection('github', { signIn: 'personal_token' })),
            },
        });
        await wrapper.find('[data-test="cx-connect-github"]').trigger('click');
        const dialog = wrapper.find('[data-test="cx-signin"]');
        expect(dialog.find('[data-test="cx-signin-oauth"]').exists()).toBe(true);
        const field = dialog.find('[data-test="cx-signin-token"]');
        expect(field.attributes('type')).toBe('password');
        expect(dialog.text()).toContain(t('Connectors.catalog.github_token_help'));

        await field.setValue(`  ${TOKEN}  `);
        await dialog.find('[data-test="cx-signin-token-form"]').trigger('submit');
        await flushPromises();

        expect(callsTo('post')).toEqual([['/github/token', { token: TOKEN }]]);
        expect(wrapper.find('[data-test="cx-signin"]').exists()).toBe(false);
        expect(wrapper.html()).not.toContain(TOKEN);
        expect(listed).toBe(2);
        expect(wrapper.find('[data-test="cx-notice"]').text()).toBe(t('Connectors.conn.return_ok', { provider: 'GitHub' }));
    });

    it('empties the field when the app refuses the token, and says why', async () => {
        const wrapper = await open({ answers: { 'post /github/token': () => refused('GitHub did not accept that token.', 'token_refused') } });
        await wrapper.find('[data-test="cx-connect-github"]').trigger('click');
        const field = wrapper.find('[data-test="cx-signin-token"]');
        await field.setValue(TOKEN);
        await wrapper.find('[data-test="cx-signin-token-form"]').trigger('submit');
        await flushPromises();
        expect(field.element.isConnected).toBe(true);
        expect(field.element.value).toBe('');
        expect(wrapper.find('[data-test="cx-signin-error"]').text()).toBe('GitHub did not accept that token.');
        expect(wrapper.html()).not.toContain(TOKEN);
    });

    it('closes on Escape', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="cx-connect-github"]').trigger('click');
        await wrapper.find('[data-test="cx-signin"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-test="cx-signin"]').exists()).toBe(false);
    });
});

describe('the connector detail panel', () => {
    const openGoogle = async (answers = {}) => {
        const wrapper = await open({ answers });
        await wrapper.find('[data-test="cx-open-google"]').trigger('click');
        await flushPromises();
        return wrapper;
    };

    it('shows the account, the products and each tool with read or write', async () => {
        const panel = (await openGoogle()).find('[data-test="cx-detail"]');
        expect(panel.find('[data-test="cx-detail-account"]').text()).toBe('maya@google.test');
        expect(panel.find('[data-test="cx-detail-product-calendar"]').element.checked).toBe(true);
        expect(panel.find('[data-test="cx-detail-product-meet"]').element.checked).toBe(false);
        const create = panel.find('[data-test="cx-tool-google.calendar.events.create"]');
        expect(create.text()).toContain(t('Connectors.tool.googleCalendarEventsCreate'));
        expect(create.text()).toContain(t('Connectors.detail.kind_write'));
    });

    it('turns a tool off and on for the person\'s own use, sending the whole list each time', async () => {
        const sent = [];
        const wrapper = await openGoogle({
            'put /connections/conn-google/tools': (body) => { sent.push(body); return ok(connection('google', { products: ['calendar'], toolsOff: body.toolsOff })); },
        });
        const switchOf = () => wrapper.find('[data-test="cx-tool-switch-google.calendar.events.create"]');
        expect(switchOf().attributes('aria-checked')).toBe('true');
        await switchOf().trigger('click');
        await flushPromises();
        expect(switchOf().attributes('aria-checked')).toBe('false');
        await switchOf().trigger('click');
        await flushPromises();
        expect(sent).toEqual([{ toolsOff: ['google.calendar.events.create'] }, { toolsOff: [] }]);
        expect(switchOf().attributes('aria-checked')).toBe('true');
    });

    it('keeps a tool the workspace turned off switched off and out of reach', async () => {
        const wrapper = await openGoogle();
        const off = wrapper.find('[data-test="cx-tool-switch-google.drive.files.read"]');
        expect(off.attributes('aria-checked')).toBe('false');
        expect(off.attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="cx-tool-workspace-off-google.drive.files.read"]').exists()).toBe(true);
    });

    it('disconnects only after the person confirms, then closes and says so', async () => {
        const wrapper = await openGoogle({ 'delete /connections/conn-google': () => ok({ connected: false }) });
        await wrapper.find('[data-test="cx-detail-disconnect"]').trigger('click');
        expect(callsTo('delete')).toEqual([]);
        await wrapper.find('[data-test="cx-detail-disconnect-confirm"]').trigger('click');
        await flushPromises();
        expect(callsTo('delete')).toEqual([['/connections/conn-google', undefined]]);
        expect(wrapper.find('[data-test="cx-detail"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="cx-notice"]').text()).toBe(t('Connectors.screen.disconnected', { provider: 'Google' }));
    });

    it('closes on Escape', async () => {
        const wrapper = await openGoogle();
        await wrapper.find('[data-test="cx-detail"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-test="cx-detail"]').exists()).toBe(false);
    });

    it('shows an owner or admin the tools an app changed, and lets them approve one', async () => {
        const reviewed = [];
        const changed = { key: 'google.calendar.events.list', tool: 'events_list', kind: 'read', label: 'Connectors.tool.googleCalendarEventsList', state: 'changed', on: false, seenAt: null };
        const wrapper = await open({
            props: { privileged: true },
            answers: {
                'get /admin/tools/google': () => ok({ tools: [changed] }),
                'put /admin/tools/google/events_list': (body) => { reviewed.push(body); return ok({ tools: [{ ...changed, state: 'reviewed', on: true }] }); },
            },
        });
        await wrapper.find('[data-test="cx-open-google"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="cx-review-approve-events_list"]').trigger('click');
        await flushPromises();
        expect(reviewed).toEqual([{ enabled: true }]);
        expect(wrapper.find('[data-test="cx-review-approve-events_list"]').exists()).toBe(false);
    });

    it('shows a member no tools to review', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="cx-open-google"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="cx-tool-reviews"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url.includes('/admin/'))).toBe(false);
    });
});
