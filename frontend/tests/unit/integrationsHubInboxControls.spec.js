import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/utils/iconMask', () => ({ maskOf: () => ({}) }));
vi.mock('@/views/Integrations/SlackConnector.vue', () => ({ default: { name: 'SlackConnector', template: '<div></div>' } }));

import IntegrationsHub from '@/views/Integrations/IntegrationsHub.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const inbox = (extra) => ({ _id: 'i1', name: 'Launch inbox', token: 't'.repeat(32), address: 'launch@inbox.example', enabled: true, receivedCount: 0, ...extra });

const openHub = async (rows, onWrite = () => Promise.resolve({ data: { status: true } })) => {
    apiRequest.mockImplementation((method, url) => {
        if (method !== 'get') return onWrite(method, url);
        return Promise.resolve({ data: { status: true, data: String(url).endsWith('/inboxes') ? rows : [] } });
    });
    const wrapper = mount(IntegrationsHub, {
        global: { provide: { $companyId: { value: 'c1' }, $userId: { value: 'u1' } }, mocks: { $t: i18n.global.t }, stubs: { 'router-link': true } },
    });
    await flushPromises();
    return wrapper;
};

const refusedWith = (status) => () => Promise.reject(Object.assign(new Error('refused'), { response: { status, data: { status: false } } }));

describe('the controls of an email inbox on the Integrations screen', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('offers pause and delete to someone who may change the inbox', async () => {
        const wrapper = await openHub([inbox({ canManage: true })]);
        expect(wrapper.find('[data-test="inbox-toggle"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="inbox-remove"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="inbox-readonly"]').exists()).toBe(false);
    });

    it('shows no pause or delete to someone who may not, and says who can', async () => {
        const wrapper = await openHub([inbox({ canManage: false })]);
        expect(wrapper.find('[data-test="inbox-toggle"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="inbox-remove"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="inbox-readonly"]').text()).toBe(en.IntegrationsHub.email_change_by);
    });

    it.each([403, 404])('says why when the server answers %s to a change', async (status) => {
        const wrapper = await openHub([inbox({ canManage: true })], refusedWith(status));
        await wrapper.find('[data-test="inbox-toggle"]').trigger('click');
        await flushPromises();
        const alert = wrapper.find('[data-test="inbox-error"]');
        expect(alert.attributes('role')).toBe('alert');
        expect(alert.text()).toBe(en.IntegrationsHub.email_change_refused);
    });

    it('says the change did not save when it fails for another reason', async () => {
        const wrapper = await openHub([inbox({ canManage: true })], () => Promise.resolve({ data: { status: false, statusText: 'E11000' } }));
        await wrapper.find('[data-test="inbox-remove"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="inbox-error"]').text()).toBe(en.IntegrationsHub.email_change_failed);
    });

    it('clears the message once a change saves', async () => {
        let refuse = true;
        const wrapper = await openHub([inbox({ canManage: true })], () => (refuse ? refusedWith(403)() : Promise.resolve({ data: { status: true } })));
        await wrapper.find('[data-test="inbox-toggle"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="inbox-error"]').exists()).toBe(true);
        refuse = false;
        await wrapper.find('[data-test="inbox-toggle"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="inbox-error"]').exists()).toBe(false);
    });
});
