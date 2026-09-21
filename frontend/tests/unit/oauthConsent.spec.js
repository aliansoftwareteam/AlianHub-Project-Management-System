import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import Consent from '@/views/OAuth/Consent.vue';

const REQUEST = 'eyJjIjoiYWhjXzEifQ.c2lnbmVk';
const CSRF = 'c'.repeat(43);
const ALPHA = '6f00000000000000000000c1';
const BETA = '6f00000000000000000000c2';
const GAMMA = '6f00000000000000000000c3';

const details = (over = {}) => ({
    client: { clientId: 'ahc_0123456789abcdef01234567', name: 'Claude Code', kind: 'dynamic', clientHost: '', redirectUri: 'http://127.0.0.1:33418/callback', redirectHost: '127.0.0.1', loopback: true },
    scopes: ['tasks:read', 'tasks:write'],
    csrf: CSRF,
    workspaces: [
        { id: ALPHA, name: 'Alpha Works', approval: 'approved', eligible: true, reason: '' },
        { id: BETA, name: 'Beta Labs', approval: 'pending', eligible: false, reason: 'not_approved' },
        { id: GAMMA, name: 'Gamma Corp', approval: 'none', eligible: false, reason: 'not_approved' },
    ],
    ...over,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const mountWith = async ({ data = details(), post } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        if (type === 'get') return typeof data === 'function' ? data(url) : ok(data);
        if (type === 'post') return post ? post(url, body) : ok({ approval: 'pending' });
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
    const wrapper = mount(Consent);
    await flushPromises();
    return wrapper;
};

describe('the OAuth consent screen', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        window.history.replaceState({}, '', `/oauth/consent?request=${REQUEST}#/oauth/consent`);
    });
    afterEach(() => { window.history.replaceState({}, '', '/'); });

    it('asks the server about the request in the page address', async () => {
        await mountWith();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('get', `/oauth/consent/details?request=${encodeURIComponent(REQUEST)}`);
    });

    it('shows the client name, the redirect hostname, a loopback warning and every scope in plain words', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find('[data-test="client-name"]').text()).toBe('Claude Code');
        expect(wrapper.find('[data-test="redirect-host"]').text()).toContain('127.0.0.1');
        expect(wrapper.find('[data-test="loopback-warning"]').text()).toBe('OAuthConsent.loopback_warning');
        expect(wrapper.findAll('[data-test^="scope-"]').map((row) => row.text())).toEqual(['OAuthConsent.scope_tasks_read', 'OAuthConsent.scope_tasks_write']);
        expect(wrapper.find('[data-test="client-host"]').exists()).toBe(false);
    });

    it('names the host of a metadata document client and gives no loopback warning for an https redirect', async () => {
        const wrapper = await mountWith({ data: details({ client: { clientId: 'https://agent.example/client.json', name: 'Doc agent', kind: 'metadata_document', clientHost: 'agent.example', redirectUri: 'https://agent.example/cb', redirectHost: 'agent.example', loopback: false } }) });
        expect(wrapper.find('[data-test="client-host"]').text()).toContain('agent.example');
        expect(wrapper.find('[data-test="loopback-warning"]').exists()).toBe(false);
    });

    it('posts a real form to /oauth/consent carrying the request and its CSRF token', async () => {
        const wrapper = await mountWith();
        const form = wrapper.find('form[data-test="consent-form"]');
        expect(form.attributes('method')).toBe('post');
        expect(form.attributes('action')).toBe('/oauth/consent');
        expect(form.find('input[name="request"]').element.value).toBe(REQUEST);
        expect(form.find('input[name="csrf"]').element.value).toBe(CSRF);
        expect(form.find('button[data-test="approve"]').attributes()).toMatchObject({ type: 'submit', name: 'decision', value: 'approve' });
        expect(form.find('button[data-test="deny"]').attributes()).toMatchObject({ type: 'submit', name: 'decision', value: 'deny' });
    });

    it('offers only the workspaces where the client is approved, and picks the only one', async () => {
        const wrapper = await mountWith();
        const choices = wrapper.findAll('input[name="workspace"]');
        expect(choices.map((input) => input.element.value)).toEqual([ALPHA]);
        expect(choices[0].element.checked).toBe(true);
        expect(wrapper.find('button[data-test="approve"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.find(`[data-test="waiting-${BETA}"]`).text()).toBe('OAuthConsent.waiting_for_admin');
        expect(wrapper.find(`button[data-test="ask-${GAMMA}"]`).exists()).toBe(true);
    });

    it('does not preselect when several workspaces are eligible, and approve waits for a choice', async () => {
        const wrapper = await mountWith({ data: details({ workspaces: [
            { id: ALPHA, name: 'Alpha Works', approval: 'approved', eligible: true, reason: '' },
            { id: BETA, name: 'Beta Labs', approval: 'approved', eligible: true, reason: '' },
        ] }) });
        expect(wrapper.findAll('input[name="workspace"]').every((input) => !input.element.checked)).toBe(true);
        expect(wrapper.find('button[data-test="approve"]').attributes('disabled')).toBeDefined();
        await wrapper.find(`input[data-test="workspace-${BETA}"]`).setValue(true);
        expect(wrapper.find('button[data-test="approve"]').attributes('disabled')).toBeUndefined();
    });

    it('says the client waits for an admin when no workspace has approved it, and deny still works', async () => {
        const wrapper = await mountWith({ data: details({ workspaces: [{ id: BETA, name: 'Beta Labs', approval: 'pending', eligible: false, reason: 'not_approved' }] }) });
        expect(wrapper.find('[data-test="no-workspace"]').text()).toBe('OAuthConsent.no_workspace');
        expect(wrapper.find('button[data-test="approve"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[data-test="deny"]').attributes('disabled')).toBeUndefined();
    });

    it('explains a workspace whose approval does not cover the requested scopes', async () => {
        const wrapper = await mountWith({ data: details({ workspaces: [{ id: ALPHA, name: 'Alpha Works', approval: 'approved', eligible: false, reason: 'scope_ceiling' }] }) });
        expect(wrapper.find(`[data-test="ceiling-${ALPHA}"]`).text()).toBe('OAuthConsent.scope_ceiling');
        expect(wrapper.findAll('input[name="workspace"]')).toHaveLength(0);
    });

    it('asks a workspace admin for approval and then shows it waiting', async () => {
        const wrapper = await mountWith();
        await wrapper.find(`button[data-test="ask-${GAMMA}"]`).trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('post', '/oauth/consent/approval-request', { request: REQUEST, csrf: CSRF, workspace: GAMMA });
        expect(wrapper.find(`[data-test="waiting-${GAMMA}"]`).text()).toBe('OAuthConsent.waiting_for_admin');
        expect(wrapper.find(`button[data-test="ask-${GAMMA}"]`).exists()).toBe(false);
    });

    it('shows an error and no form when the request has expired', async () => {
        const wrapper = await mountWith({ data: () => Promise.reject({ response: { status: 400, data: { status: false, statusText: 'expired' } } }) });
        expect(wrapper.find('[data-test="consent-error"]').text()).toBe('OAuthConsent.expired');
        expect(wrapper.find('form[data-test="consent-form"]').exists()).toBe(false);
    });

    it('shows an error without asking the server when the address carries no request', async () => {
        window.history.replaceState({}, '', '/oauth/consent#/oauth/consent');
        const wrapper = await mountWith();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="consent-error"]').exists()).toBe(true);
    });
});
