import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import AdminConnections from '@/views/Integrations/AdminConnections.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors';
const MAYA = '6f0000000000000000000a03';
const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusal = (statusText) => Promise.reject({ response: { data: { status: false, statusText } } });

const storeFor = (roleType) => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), companyUsers: () => [] } },
    users: { namespaced: true, getters: { users: () => [{ _id: MAYA, Employee_Name: 'Maya Shah' }] } },
} });

const rowOf = (over = {}) => ({ connectionId: 'c1', userId: MAYA, provider: 'google', products: ['calendar'], scopes: ['openid'], status: 'connected', lastUsedAt: null, ...over });

const serve = ({ connections = [rowOf()], answers = {} } = {}) => {
    apiRequest.mockImplementation((method, url) => {
        const key = `${method} ${url.slice(BASE.length)}`;
        if (answers[key]) return answers[key]();
        if (key === 'get /members') return ok({ connections });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const open = async ({ roleType = OWNER, ...served } = {}) => {
    serve(served);
    const wrapper = mount(AdminConnections, { global: { plugins: [storeFor(roleType)], mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method).map(([, url]) => url.slice(BASE.length));

beforeEach(() => {
    apiRequest.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('who can see the members\' connections', () => {
    it('shows nothing and asks for nothing from a member', async () => {
        const wrapper = await open({ roleType: MEMBER });
        expect(wrapper.find('[data-test="admin-connections"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it.each([OWNER, ADMIN])('role %s reads the list and sees who is connected by name', async (roleType) => {
        const wrapper = await open({ roleType });
        expect(callsTo('get')).toEqual(['/members']);
        const row = wrapper.find('[data-test="ac-row-c1"]');
        expect(row.text()).toContain('Maya Shah');
        expect(row.text()).toContain(t('Connectors.conn.provider_google'));
        expect(row.text()).toContain(t('Connectors.conn.status_connected'));
    });
});

describe('ending a connection', () => {
    it('ends it after asking, then reads the list again', async () => {
        const wrapper = await open({ answers: { 'delete /connections/c1': () => ok({}) } });
        serve({ connections: [], answers: { 'delete /connections/c1': () => ok({}) } });
        await wrapper.find('[data-test="ac-end-c1"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith(t('Connectors.conn.confirm_end', { member: 'Maya Shah', provider: 'Google' }));
        expect(callsTo('delete')).toEqual(['/connections/c1']);
        expect(wrapper.find('[data-test="ac-empty"]').text()).toBe(t('Connectors.conn.admin_empty'));
    });

    it('does not end it when the question is declined', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await open();
        await wrapper.find('[data-test="ac-end-c1"]').trigger('click');
        await flushPromises();
        expect(callsTo('delete')).toEqual([]);
    });

    it('says in the locale\'s words when the list cannot be loaded', async () => {
        const wrapper = await open({ answers: { 'get /members': () => refusal('Nope.') } });
        expect(wrapper.find('[data-test="ac-load-error"]').text()).toBe('Nope.');
    });
});
