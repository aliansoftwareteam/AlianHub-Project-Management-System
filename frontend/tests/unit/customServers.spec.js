import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {}, params: { cid: 'c1' } },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: vi.fn() }) }));

import CustomServers from '@/views/Integrations/CustomServers.vue';
import AddCustomConnector from '@/views/Integrations/AddCustomConnector.vue';
import CustomServerTools from '@/views/Integrations/CustomServerTools.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const SERVERS = '/api/v2/connectors/servers';
const SERVER = {
    serverId: '6f0000000000000000000001', provider: 'custom_6f0000000000000000000001', name: 'Team notes', url: 'https://mcp.plain.test/mcp',
    signIn: 'personal_token', status: 'active', hosts: ['mcp.plain.test'], mayManage: true, connection: { connected: false },
};

const mountWith = (component, props = {}) => mount(component, { props, global: { mocks: { $t: t }, stubs: { teleport: true } } });

beforeEach(() => {
    apiRequest.mockReset();
    route.query = {};
});

describe('the custom apps card', () => {
    const listing = (data) => apiRequest.mockImplementation((method, url) => (url === SERVERS ? Promise.resolve({ data: { status: true, data } }) : Promise.resolve({ data: { status: true, data: {} } })));

    it('draws no Add button for someone without the right to add custom apps', async () => {
        listing({ servers: [], mayAdd: false });
        const wrapper = mountWith(CustomServers);
        await flushPromises();
        expect(wrapper.find('[data-test="custom-servers"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="csv-add"]').exists()).toBe(false);
    });

    it('opens the add dialog for someone who holds the right', async () => {
        listing({ servers: [], mayAdd: true });
        const wrapper = mountWith(CustomServers);
        await flushPromises();
        await wrapper.find('[data-test="csv-add"]').trigger('click');
        expect(wrapper.findComponent(AddCustomConnector).exists()).toBe(true);
    });

    it('is not drawn at all while custom apps are switched off', async () => {
        apiRequest.mockRejectedValue({ response: { status: 404, data: { status: false, code: 'custom_off' } } });
        const wrapper = mountWith(CustomServers);
        await flushPromises();
        expect(wrapper.find('[data-test="custom-servers"]').exists()).toBe(false);
    });

    it('asks a member of a token app for their own token, and offers its tools only to who may manage it', async () => {
        listing({ servers: [SERVER, { ...SERVER, serverId: 'other', name: 'Other', mayManage: false }], mayAdd: false });
        const wrapper = mountWith(CustomServers);
        await flushPromises();
        expect(wrapper.find(`[data-test="csv-token-${SERVER.serverId}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-test="csv-tools-${SERVER.serverId}"]`).exists()).toBe(true);
        expect(wrapper.find('[data-test="csv-tools-other"]').exists()).toBe(false);
    });
});

describe('adding a custom app', () => {
    it('asks for the client ID and secret of an app that needs one, with the address to register', async () => {
        const needsApp = { ...SERVER, signIn: 'registered_app', status: 'needs_app', callback: 'http://localhost:4000/api/v1/connector-oauth/custom_x/callback' };
        apiRequest.mockImplementation((method, url, body) => {
            if (method === 'post') return Promise.resolve({ data: { status: true, data: { server: needsApp } } });
            return Promise.resolve({ data: { status: true, data: { server: { ...needsApp, status: 'active', hasApp: true, echo: body } } } });
        });
        const wrapper = mountWith(AddCustomConnector);
        await wrapper.find('[data-test="acc-name"]').setValue('Corp tracker');
        await wrapper.find('[data-test="acc-url"]').setValue('https://mcp.corp.test/mcp');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', SERVERS, { name: 'Corp tracker', url: 'https://mcp.corp.test/mcp' });
        expect(wrapper.find('[data-test="acc-callback"]').text()).toBe(needsApp.callback);
        await wrapper.find('[data-test="acc-client-id"]').setValue('corp-client');
        await wrapper.find('[data-test="acc-client-secret"]').setValue('corp-secret');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', `${SERVERS}/${SERVER.serverId}`, { clientId: 'corp-client', clientSecret: 'corp-secret' });
        expect(wrapper.find('[data-test="acc-done"]').exists()).toBe(true);
    });

    it('shows the server\'s refusal and keeps the dialog open', async () => {
        apiRequest.mockRejectedValue({ response: { status: 400, data: { status: false, statusText: 'The address must start with https://.' } } });
        const wrapper = mountWith(AddCustomConnector);
        await wrapper.find('[data-test="acc-name"]').setValue('X');
        await wrapper.find('[data-test="acc-url"]').setValue('http://x.test');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="acc-error"]').text()).toBe('The address must start with https://.');
    });
});

describe('reviewing a custom app\'s tools', () => {
    const TOOL = {
        tool: 'search_notes', shape: 'a'.repeat(64), usable: true,
        outside: { name: 'search_notes', description: 'Search the notes of the signed-in person.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        review: { state: 'new', enabled: false, access: 'write', label: 'search_notes', description: 'Search the notes of the signed-in person.' },
    };

    it('marks what the app says as outside content, and saves against the version shown', async () => {
        apiRequest.mockImplementation((method) => (method === 'get'
            ? Promise.resolve({ data: { status: true, data: { tools: [TOOL] } } })
            : Promise.resolve({ data: { status: true, data: { tool: { ...TOOL, review: { ...TOOL.review, state: 'reviewed', enabled: true, access: 'read' } } } } })));
        const wrapper = mountWith(CustomServerTools, { server: SERVER });
        await flushPromises();
        expect(wrapper.text()).toContain(t('Connectors.custom.outside_label'));
        expect(wrapper.text()).toContain(t('Connectors.custom.outside_note'));
        await wrapper.find('[data-test="cst-on-search_notes"]').setValue(true);
        await wrapper.find('[data-test="cst-access-search_notes"]').setValue('read');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', `${SERVERS}/${SERVER.serverId}/tools/search_notes`, expect.objectContaining({ enabled: true, access: 'read', shape: TOOL.shape }));
    });
});
