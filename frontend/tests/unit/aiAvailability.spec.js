import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import { AI_STATE, aiAvailability, aiUsable, applyAiAvailability, loadAiAvailability, messageKeysFor, resetAiAvailability, setWorkspaceAi } from '@/composable/aiAvailability';
import AiUnavailable from '@/components/molecules/AiUnavailable/AiUnavailable.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const blank = { render: () => null };

const routerFor = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/:cid/ai', name: 'AiHome', component: blank },
        { path: '/:cid/settings/setting', name: 'Setting', component: blank },
        { path: '/:cid/settings/instance/settings', name: 'InstanceSettings', component: blank },
    ],
});

const mountFor = async (data) => {
    applyAiAvailability(data);
    const router = routerFor();
    await router.push('/c1/ai');
    await router.isReady();
    const wrapper = mount(AiUnavailable, { global: { plugins: [router], provide: { $companyId: 'c1' } } });
    await flushPromises();
    return wrapper;
};

describe('AI availability', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        resetAiAvailability();
    });

    it('treats AI as usable until the server has answered, so nothing flickers away on load', () => {
        expect(aiAvailability.state).toBe(AI_STATE.UNKNOWN);
        expect(aiUsable.value).toBe(true);
    });

    it('loads the state for the workspace and hides AI for every state but on', async () => {
        apiRequest.mockImplementation(() => ok({ state: 'off_workspace', canManageWorkspace: true, canConfigureInstance: false, instanceEnabled: true, workspaceEnabled: false }));
        await loadAiAvailability('c1');
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/ai-switch');
        expect(aiAvailability).toMatchObject({ state: 'off_workspace', canManageWorkspace: true, workspaceEnabled: false, companyId: 'c1' });
        expect(aiUsable.value).toBe(false);

        for (const state of ['off_instance', 'unconfigured']) {
            applyAiAvailability({ state });
            expect(aiUsable.value).toBe(false);
        }
        applyAiAvailability({ state: 'on' });
        expect(aiUsable.value).toBe(true);
    });

    it('keeps AI usable when the read fails, since the server still refuses what is off', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('network')));
        await loadAiAvailability('c1');
        expect(aiUsable.value).toBe(true);
    });

    it('saves the workspace switch and takes the answer as the new state', async () => {
        apiRequest.mockImplementation(() => ok({ state: 'off_workspace', workspaceEnabled: false, canManageWorkspace: true }));
        await setWorkspaceAi(false);
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/ai-switch', { enabled: false });
        expect(aiAvailability.state).toBe('off_workspace');
    });

    it('picks a message and an action for who is looking', () => {
        expect(messageKeysFor({ state: 'unconfigured', canConfigureInstance: true })).toEqual({ title: 'AiAvailability.unconfigured_title', body: 'AiAvailability.unconfigured_owner', action: 'InstanceSettings' });
        expect(messageKeysFor({ state: 'unconfigured', canConfigureInstance: false })).toEqual({ title: 'AiAvailability.unavailable_title', body: 'AiAvailability.unconfigured_member', action: null });
        expect(messageKeysFor({ state: 'off_instance', canConfigureInstance: true })).toEqual({ title: 'AiAvailability.off_title', body: 'AiAvailability.off_instance', action: 'InstanceSettings' });
        expect(messageKeysFor({ state: 'off_instance', canConfigureInstance: false })).toEqual({ title: 'AiAvailability.off_title', body: 'AiAvailability.off_instance', action: null });
        expect(messageKeysFor({ state: 'off_workspace', canManageWorkspace: true })).toEqual({ title: 'AiAvailability.off_title', body: 'AiAvailability.off_workspace_manager', action: 'Setting' });
        expect(messageKeysFor({ state: 'off_workspace', canManageWorkspace: false })).toEqual({ title: 'AiAvailability.off_title', body: 'AiAvailability.off_workspace_member', action: null });
    });
});

describe('the AI unavailable panel', () => {
    beforeEach(() => resetAiAvailability());

    it('tells the instance owner to set up a provider, with a link to Instance settings', async () => {
        const wrapper = await mountFor({ state: 'unconfigured', canConfigureInstance: true });
        expect(wrapper.find('[role="status"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('AiAvailability.unconfigured_title');
        expect(wrapper.text()).toContain('AiAvailability.unconfigured_owner');
        expect(wrapper.find('a').attributes('href')).toBe('/c1/settings/instance/settings?group=ai');
    });

    it('tells a member that AI is not available, with nothing to click', async () => {
        const wrapper = await mountFor({ state: 'unconfigured', canConfigureInstance: false });
        expect(wrapper.text()).toContain('AiAvailability.unavailable_title');
        expect(wrapper.find('a').exists()).toBe(false);
    });

    it('tells a workspace admin that AI is turned off here, with a link to the switch', async () => {
        const wrapper = await mountFor({ state: 'off_workspace', canManageWorkspace: true });
        expect(wrapper.text()).toContain('AiAvailability.off_title');
        expect(wrapper.find('a').attributes('href')).toBe('/c1/settings/setting');
    });
});
