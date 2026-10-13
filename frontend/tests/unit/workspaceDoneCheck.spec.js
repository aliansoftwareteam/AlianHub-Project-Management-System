import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/composable/index.js', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/views/Ai/useAgents', () => ({ reasonOf: (error, key) => key }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/AccountAttribution.vue', () => ({ default: { name: 'AccountAttribution', render: () => null } }));

import AiAccounts from '@/views/Ai/AiAccounts.vue';
import en from '@/locales/en.js';
import { ROLE_ADMIN, ROLE_GUEST, ROLE_MEMBER, ROLE_OWNER } from '@/utils/roles';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const POLICY_URL = '/api/v2/agents/policy';
const MODES = ['workspace', 'personal', 'local'];
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));

const serve = ({ checks = false, onPut = null } = {}) => {
    const held = { allowedModes: [...MODES], requireCheckBeforeDone: checks };
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url === '/api/v2/agents/account') return ok({ account: null, policy: { ...held }, summary: {} });
        if (method === 'get' && url === POLICY_URL) return ok({ ...held });
        if (method === 'put' && url === POLICY_URL) return onPut ? onPut(body) : ok(Object.assign(held, body));
        return ok([]);
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { protocolVersion: '', tools: [], never: [] } } });
    return held;
};

const store = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } },
    },
});

const open = async (roleType, setup, provide = {}) => {
    const held = serve(setup);
    const wrapper = mount(AiAccounts, { global: { plugins: [store(roleType)], mocks: { $t: t }, provide } });
    await flushPromises();
    wrapper.held = held;
    return wrapper;
};
const liveSocket = () => {
    const listeners = {};
    const socket = { on: vi.fn((event, handler) => { listeners[event] = handler; }), off: vi.fn((event, handler) => { if (listeners[event] === handler) delete listeners[event]; }) };
    return { listeners, provide: { $socket: ref(socket) } };
};
const policyReads = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url === POLICY_URL).length;
const modeBoxes = (wrapper) => wrapper.findAll('.acct-policy__row input').slice(0, MODES.length).map((input) => input.element.checked);

const card = (wrapper) => wrapper.find('[data-test="workspace-done-check"]');
const box = (wrapper) => wrapper.find('[data-test="done-check-switch"]');
const policyPuts = () => apiRequest.mock.calls.filter(([method, url]) => method === 'put' && url === POLICY_URL).map(([, , body]) => body);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the workspace setting that has a person check before Done', () => {
    it('sits beside the workspace\'s other agent settings, off as the workspace holds it, in plain words', async () => {
        const wrapper = await open(ROLE_OWNER);
        expect(card(wrapper).exists()).toBe(true);
        expect(box(wrapper).element.checked).toBe(false);
        expect(box(wrapper).element.disabled).toBe(false);
        expect(card(wrapper).text()).toContain(t('Accounts.done_check_title'));
        expect(card(wrapper).text()).toContain(t('Accounts.done_check_label'));
        expect(card(wrapper).text()).toContain(t('Accounts.done_check_effect'));
    });

    it('shows it on when the workspace holds it on', async () => {
        const wrapper = await open(ROLE_ADMIN, { checks: true });
        expect(box(wrapper).element.checked).toBe(true);
    });

    it.each([['an owner', ROLE_OWNER], ['an admin', ROLE_ADMIN]])('saves the switch alone the moment %s turns it on, and says it is saved', async (who, roleType) => {
        const wrapper = await open(roleType);
        await box(wrapper).setValue(true);
        await flushPromises();
        expect(policyPuts()).toEqual([{ requireCheckBeforeDone: true }]);
        expect(box(wrapper).element.checked).toBe(true);
        expect(card(wrapper).find('[data-test="done-check-saved"]').text()).toBe(t('Accounts.policy_saved'));
    });

    it('turns it off the same way', async () => {
        const wrapper = await open(ROLE_OWNER, { checks: true });
        await box(wrapper).setValue(false);
        await flushPromises();
        expect(policyPuts()).toEqual([{ requireCheckBeforeDone: false }]);
        expect(box(wrapper).element.checked).toBe(false);
    });

    it('goes back to what the workspace holds and gives the reason when the server refuses', async () => {
        const wrapper = await open(ROLE_OWNER, { onPut: () => refused('Owner/admin only.') });
        await box(wrapper).setValue(true);
        await flushPromises();
        expect(box(wrapper).element.checked).toBe(false);
        expect(card(wrapper).find('[role="alert"]').text()).toBe('Owner/admin only.');
        expect(card(wrapper).find('[data-test="done-check-saved"]').exists()).toBe(false);
    });

    it.each([['a member', ROLE_MEMBER], ['a guest', ROLE_GUEST]])('is shown to %s as it stands, and cannot be changed', async (who, roleType) => {
        const wrapper = await open(roleType, { checks: true });
        expect(box(wrapper).element.checked).toBe(true);
        expect(box(wrapper).element.disabled).toBe(true);
        expect(card(wrapper).text()).toContain(t('Accounts.policy_read_only'));
        await box(wrapper).trigger('change');
        await flushPromises();
        expect(policyPuts()).toEqual([]);
    });

    it('leaves the switch out of what saving the allowed modes sends', async () => {
        const wrapper = await open(ROLE_OWNER, { checks: true });
        await wrapper.findAll('.acct-policy__row input').at(0).setValue(false);
        await wrapper.findAll('button').find((button) => button.text() === t('Accounts.save_policy')).trigger('click');
        await flushPromises();
        expect(policyPuts()).toEqual([{ allowedModes: ['personal', 'local'] }]);
        expect(box(wrapper).element.checked).toBe(true);
    });

    it('follows a change made elsewhere: the switch and the allowed modes are read again, for a member too', async () => {
        const live = liveSocket();
        const wrapper = await open(ROLE_MEMBER, {}, live.provide);
        expect(policyReads()).toBe(0);
        Object.assign(wrapper.held, { requireCheckBeforeDone: true, allowedModes: ['workspace'] });
        live.listeners.agentsChanged({ kind: 'policy' });
        await flushPromises();
        expect(policyReads()).toBe(1);
        expect(box(wrapper).element.checked).toBe(true);
        expect(modeBoxes(wrapper)).toEqual([true, false, false]);
    });

    it('reads nothing again for a change of another kind, and stops listening when the page closes', async () => {
        const live = liveSocket();
        const wrapper = await open(ROLE_OWNER, {}, live.provide);
        live.listeners.agentsChanged({ kind: 'run' });
        await flushPromises();
        expect(policyReads()).toBe(0);
        wrapper.unmount();
        expect(live.listeners.agentsChanged).toBeUndefined();
    });
});
