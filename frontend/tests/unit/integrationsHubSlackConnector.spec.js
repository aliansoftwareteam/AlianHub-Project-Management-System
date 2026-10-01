import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/utils/iconMask', () => ({ maskOf: () => ({}) }));
vi.mock('@/views/Integrations/SlackConnector.vue', () => ({
    default: { name: 'SlackConnector', template: '<div data-test="slack-connector-stub"></div>' },
}));

import IntegrationsHub from '@/views/Integrations/IntegrationsHub.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const SLACK_RAIL = 4;

const openSlack = async (catalogue) => {
    apiRequest.mockImplementation((method, url) => Promise.resolve({ data: url.endsWith('/catalog') ? catalogue : { status: true, data: [] } }));
    const wrapper = mount(IntegrationsHub, {
        global: { provide: { $companyId: { value: 'c1' }, $userId: { value: 'u1' } }, mocks: { $t: i18n.global.t }, stubs: { 'router-link': true } },
    });
    await flushPromises();
    await wrapper.findAll('.ig-cat')[SLACK_RAIL].trigger('click');
    return wrapper;
};

describe('the Slack connector on the Integrations screen', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('has no section while the server does not name the connector', async () => {
        const wrapper = await openSlack({ status: true, data: [] });
        expect(wrapper.find('[data-test="slack-connector-stub"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/connectors'))).toBe(false);
    });

    it('shows the section once the server names the connector', async () => {
        const wrapper = await openSlack({ status: true, data: [], connectors: ['slack'] });
        expect(wrapper.find('[data-test="slack-connector-stub"]').exists()).toBe(true);
    });
});
