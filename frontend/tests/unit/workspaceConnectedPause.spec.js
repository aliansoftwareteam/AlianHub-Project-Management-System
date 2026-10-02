import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));

import WorkspaceConnectedPause from '@/views/Ai/WorkspaceConnectedPause.vue';
import { useAccounts } from '@/views/Ai/useAccounts';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const POLICY_URL = '/api/v2/agents/policy';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));

const open = async ({ privileged = true, paused = false, onPut = null } = {}) => {
    const held = { allowedModes: ['workspace'], requireCheckBeforeDone: false, connectedPaused: paused };
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url === POLICY_URL) return ok({ ...held });
        if (method === 'put' && url === POLICY_URL) return onPut ? onPut(body) : ok(Object.assign(held, body));
        return ok([]);
    });
    await useAccounts().loadPolicy();
    const wrapper = mount(WorkspaceConnectedPause, { props: { privileged }, global: { mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const box = (wrapper) => wrapper.find('[data-test="connected-pause-switch"]');
const puts = () => apiRequest.mock.calls.filter(([method, url]) => method === 'put' && url === POLICY_URL).map(([, , body]) => body);

beforeEach(() => { apiRequest.mockReset(); });

describe('the workspace setting that pauses connected agents', () => {
    it('says in plain words what it holds, and shows it off as the workspace holds it', async () => {
        const wrapper = await open();
        expect(box(wrapper).element.checked).toBe(false);
        expect(box(wrapper).element.disabled).toBe(false);
        [t('Accounts.connected_pause_title'), t('Accounts.connected_pause_label'), t('Accounts.connected_pause_effect')].forEach((text) => expect(wrapper.text()).toContain(text));
    });

    it('shows it on after every agent was paused, and resumes connected agents when an owner or admin turns it off', async () => {
        const wrapper = await open({ paused: true });
        expect(box(wrapper).element.checked).toBe(true);
        await box(wrapper).setValue(false);
        await flushPromises();
        expect(puts()).toEqual([{ connectedPaused: false }]);
        expect(box(wrapper).element.checked).toBe(false);
        expect(wrapper.find('[data-test="connected-pause-saved"]').text()).toBe(t('Accounts.policy_saved'));
    });

    it('pauses connected agents on its own, without touching the rest of the workspace\'s settings', async () => {
        const wrapper = await open();
        await box(wrapper).setValue(true);
        await flushPromises();
        expect(puts()).toEqual([{ connectedPaused: true }]);
        expect(box(wrapper).element.checked).toBe(true);
    });

    it('goes back to what the workspace holds and gives the reason when the server refuses', async () => {
        const wrapper = await open({ paused: true, onPut: () => refused('Owner/admin only.') });
        await box(wrapper).setValue(false);
        await flushPromises();
        expect(box(wrapper).element.checked).toBe(true);
        expect(wrapper.find('[role="alert"]').text()).toBe('Owner/admin only.');
        expect(wrapper.find('[data-test="connected-pause-saved"]').exists()).toBe(false);
    });

    it('is shown to a member as it stands, and cannot be changed', async () => {
        const wrapper = await open({ privileged: false, paused: true });
        expect(box(wrapper).element.checked).toBe(true);
        expect(box(wrapper).element.disabled).toBe(true);
        expect(wrapper.text()).toContain(t('Accounts.policy_read_only'));
        await box(wrapper).trigger('change');
        await flushPromises();
        expect(puts()).toEqual([]);
    });
});
