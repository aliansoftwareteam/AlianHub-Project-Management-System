import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ProviderKeys from '@/views/Settings/RoutingPolicy/ProviderKeys.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const ROUTE = '/api/v2/provider-keys';
const KEY_ID = 'k0123456789abcdef';
const ROTATED = '2026-09-10T09:00:00.000Z';
const RESOLVED = '2026-09-17T18:30:00.000Z';
const when = (iso) => new Date(iso).toLocaleString();

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const serve = ({ off = false, rows = [] } = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url === ROUTE) {
            return off
                ? Promise.resolve({ data: { status: false, statusText: 'Workspace provider keys are off.', storeOff: true } })
                : Promise.resolve({ data: { status: true, data: rows } });
        }
        if (method === 'put') return Promise.resolve({ data: { status: true, data: { provider: url.split('/').pop(), set: true, keyId: KEY_ID, rotatedAt: ROTATED } } });
        if (method === 'delete') return Promise.resolve({ data: { status: true, data: { provider: url.split('/').pop(), set: false } } });
        return Promise.reject(new Error(`unexpected ${method} ${url} ${JSON.stringify(body)}`));
    });
};

const open = async ({ roleType = 1, ...setup } = {}) => {
    serve(setup);
    const wrapper = mount(ProviderKeys, { global: { plugins: [storeFor(roleType)], mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const row = (over) => ({ provider: 'openai', set: false, ...over });

beforeEach(() => {
    apiRequest.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the workspace provider keys panel', () => {
    it('renders each provider with its key state and never a value', async () => {
        const wrapper = await open({
            rows: [
                row({ provider: 'openai', set: true, keyId: KEY_ID, lastResolvedAt: RESOLVED }),
                row({ provider: 'anthropic', set: false, stale: true }),
                row({ provider: 'google', set: false }),
            ],
        });
        const panel = wrapper.find('[data-test="provider-keys"]');
        expect(panel.exists()).toBe(true);
        expect(panel.text()).toContain(t('ProviderKeys.lead'));
        expect(t('ProviderKeys.lead')).toMatch(/never shown/i);
        expect(panel.find('[data-test="provider-openai"] [data-test="key-state"]').text()).toContain(KEY_ID);
        expect(panel.find('[data-test="provider-openai"] [data-test="key-state"]').text()).toContain(when(RESOLVED));
        expect(panel.find('[data-test="provider-anthropic"] [data-test="key-state"]').text()).toBe(t('ProviderKeys.status_stale'));
        expect(panel.find('[data-test="provider-google"] [data-test="key-state"]').text()).toBe(t('ProviderKeys.status_instance'));
    });

    it('saves a key through PUT without ever rendering it', async () => {
        const wrapper = await open({ rows: [row({ provider: 'openai' })] });
        await wrapper.find('[data-test="provider-openai"] [data-test="key-set"]').trigger('click');
        await wrapper.find('[data-test="key-input"]').setValue('sk-live-workspace-key');
        await wrapper.find('[data-test="key-form"]').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', `${ROUTE}/openai`, { value: 'sk-live-workspace-key' });
        expect(wrapper.find('[data-test="provider-openai"] [data-test="key-state"]').text()).toContain(KEY_ID);
        expect(wrapper.html()).not.toContain('sk-live-workspace-key');
    });

    it('refuses an empty value without sending a request', async () => {
        const wrapper = await open({ rows: [row({ provider: 'openai' })] });
        await wrapper.find('[data-test="provider-openai"] [data-test="key-set"]').trigger('click');
        await wrapper.find('[data-test="key-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="key-error"]').text()).toBe(t('ProviderKeys.err_value'));
        expect(apiRequest.mock.calls.filter(([method]) => method === 'put')).toEqual([]);
    });

    it('clears a key through DELETE after confirming', async () => {
        const wrapper = await open({ rows: [row({ provider: 'openai', set: true, keyId: KEY_ID })] });
        await wrapper.find('[data-test="provider-openai"] [data-test="key-clear"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalled();
        expect(apiRequest).toHaveBeenCalledWith('delete', `${ROUTE}/openai`);
        expect(wrapper.find('[data-test="provider-openai"] [data-test="key-state"]').text()).toBe(t('ProviderKeys.status_instance'));
    });

    it('shows the off note while the flag is off', async () => {
        const off = await open({ off: true });
        expect(off.find('[data-test="keys-off"]').exists()).toBe(true);
        expect(off.find('[data-test="key-form"]').exists()).toBe(false);
    });

    it('hides everything from a member without probing', async () => {
        const member = await open({ roleType: 3, rows: [row({})] });
        expect(member.find('[data-test="provider-keys"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
