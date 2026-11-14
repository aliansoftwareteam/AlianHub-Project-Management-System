import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/utils/iconMask', () => ({ maskOf: () => ({}) }));

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

describe('the Slack note on the Integrations screen', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('says nothing of personal Slack while the server does not name it', async () => {
        const wrapper = await openSlack({ status: true, data: [] });
        expect(wrapper.find('[data-test="slack-personal-note"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/connectors'))).toBe(false);
    });

    it('points to the Connectors screen once the server names Slack, with no bot form', async () => {
        const wrapper = await openSlack({ status: true, data: [], connectors: ['slack'] });
        expect(wrapper.find('[data-test="slack-personal-note"]').text()).toContain('AI › Customize › Connectors');
        expect(wrapper.find('[data-test="slack-secret"]').exists()).toBe(false);
    });
});
