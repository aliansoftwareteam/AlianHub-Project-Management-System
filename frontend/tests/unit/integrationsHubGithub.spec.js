import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route } = vi.hoisted(() => ({ apiRequest: vi.fn(), route: { query: {}, params: { cid: 'c1' } } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/utils/iconMask', () => ({ maskOf: () => ({}) }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => ({ replace: vi.fn() }) }));

import IntegrationsHub from '@/views/Integrations/IntegrationsHub.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const CATALOGUE = [
    { key: 'github', name: 'GitHub', icon: 'G', category: 'Development', description: '', fields: [] },
    { key: 'gitlab', name: 'GitLab', icon: 'L', category: 'Development', description: '', fields: [] },
];

const open = async ({ query = {}, connectors } = {}) => {
    route.query = query;
    apiRequest.mockImplementation((method, url) => Promise.resolve({
        data: url.endsWith('/catalog') ? { status: true, data: CATALOGUE, ...(connectors ? { connectors } : {}) } : { status: true, data: [] },
    }));
    const wrapper = mount(IntegrationsHub, {
        global: {
            provide: { $companyId: { value: 'c1' }, $userId: { value: 'u1' } },
            mocks: { $t: i18n.global.t },
            stubs: { 'router-link': true, AppConnections: true },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('GitHub on the Integrations screen', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('opens on the GitHub section when a link names it, with the workspace sync limited to GitHub', async () => {
        const wrapper = await open({ query: { section: 'github' } });
        expect(wrapper.find('[data-test="github-section"]').text()).toContain(en.IntegrationsHub.github_intro);
        expect(wrapper.findComponent({ name: 'AppConnections' }).props('only')).toEqual(['github']);
    });

    it('opens on the GitHub section when a GitHub sign-in comes back, so it can finish', async () => {
        const wrapper = await open({ query: { github: 'complete', state: 's', code: 'c' } });
        expect(wrapper.find('[data-test="github-section"]').exists()).toBe(true);
    });

    it('opens on Email to Task for an unknown section', async () => {
        const wrapper = await open({ query: { section: 'nope' } });
        expect(wrapper.find('[data-test="github-section"]').exists()).toBe(false);
        expect(wrapper.find('.ig-cat.active').text()).toContain(en.IntegrationsHub.emailToTask);
    });

    it('leaves GitHub out of the Marketplace, so it is connected in one place', async () => {
        const wrapper = await open({ query: { section: 'marketplace' } });
        const names = wrapper.findAll('.ig-mp-name').map((node) => node.text());
        expect(names).toEqual(['GitLab']);
    });

    it('says what the page holds, and points to Connectors only while the server has connectors', async () => {
        const without = await open();
        expect(without.find('[data-test="integrations-lead"]').text()).toBe(en.IntegrationsHub.lead);
        const withConnectors = await open({ query: { section: 'github' }, connectors: ['github'] });
        expect(withConnectors.find('[data-test="integrations-lead"]').text()).toContain(en.IntegrationsHub.lead_connectors);
        expect(withConnectors.find('[data-test="github-connectors-note"]').text()).toContain(en.IntegrationsHub.github_connectors_note);
    });
});
