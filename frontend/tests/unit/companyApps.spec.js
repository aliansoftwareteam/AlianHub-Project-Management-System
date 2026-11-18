import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import CompanyApps from '@/views/Integrations/CompanyApps.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors';
const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusal = (statusText) => Promise.reject({ response: { data: { status: false, statusText } } });

const storeFor = (roleType) => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
} });

const catalogOf = (over = {}) => [{
    provider: 'google', name: 'Google', redirectUri: 'https://api.example.com/api/v1/connector-oauth/google/callback',
    companyAppSet: false, hasInstanceApp: true, ...over,
}];

const serve = ({ apps = [], catalog = catalogOf(), answers = {} } = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        const key = `${method} ${url.slice(BASE.length)}`;
        if (answers[key]) return answers[key](body);
        if (key === 'get /apps') return ok({ apps, catalog });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const open = async ({ roleType = OWNER, ...served } = {}) => {
    serve(served);
    const wrapper = mount(CompanyApps, { global: { plugins: [storeFor(roleType)], mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method).map(([, url, body]) => [url.slice(BASE.length), body]);

beforeEach(() => {
    apiRequest.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('who can manage the company OAuth apps', () => {
    it('shows nothing and asks for nothing from a member', async () => {
        const wrapper = await open({ roleType: MEMBER });
        expect(wrapper.find('[data-test="company-apps"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it.each([OWNER, ADMIN])('role %s reads the catalogue and shows each connector with its redirect URI and source', async (roleType) => {
        const wrapper = await open({ roleType });
        expect(callsTo('get')).toEqual([['/apps', undefined]]);
        const row = wrapper.find('[data-test="ca-row-google"]');
        expect(row.text()).toContain('Google');
        expect(row.find('[data-test="ca-source-google"]').text()).toBe(t('Connectors.conn.source_instance'));
        expect(row.text()).toContain('https://api.example.com/api/v1/connector-oauth/google/callback');
    });
});

describe('setting and removing a company app', () => {
    it('sends the client id and secret, then reads the catalogue again', async () => {
        const wrapper = await open({ answers: { 'put /apps/google': () => ok({}) } });
        await wrapper.find('[data-test="ca-edit-google"]').trigger('click');
        await wrapper.find('[data-test="ca-client-id-google"]').setValue('cid-123');
        await wrapper.find('[data-test="ca-client-secret-google"]').setValue('secret-xyz');
        serve({ catalog: catalogOf({ companyAppSet: true }), answers: { 'put /apps/google': () => ok({}) } });
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(callsTo('put')).toEqual([['/apps/google', { clientId: 'cid-123', clientSecret: 'secret-xyz' }]]);
    });

    it('will not save without both fields', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="ca-edit-google"]').trigger('click');
        await wrapper.find('[data-test="ca-client-id-google"]').setValue('cid-123');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(callsTo('put')).toEqual([]);
        expect(wrapper.find('[data-test="ca-error-google"]').text()).toBe(t('Connectors.conn.client_secret_required'));
    });

    it('removes the company app after asking', async () => {
        const wrapper = await open({ catalog: catalogOf({ companyAppSet: true }), answers: { 'delete /apps/google': () => ok({}) } });
        serve({ catalog: catalogOf({ companyAppSet: false }), answers: { 'delete /apps/google': () => ok({}) } });
        await wrapper.find('[data-test="ca-remove-google"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('Connectors.conn.confirm_remove', { provider: 'Google' }));
        expect(callsTo('delete')).toEqual([['/apps/google', undefined]]);
    });

    it('says in the locale\'s words when the catalogue cannot be loaded', async () => {
        const wrapper = await open({ answers: { 'get /apps': () => refusal('Nope.') } });
        expect(wrapper.find('[data-test="ca-load-error"]').text()).toBe('Nope.');
    });
});
