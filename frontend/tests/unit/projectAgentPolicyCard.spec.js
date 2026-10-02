import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));

import ProjectAgentPolicyCard from '@/views/Projects/ProjectDetail/ProjectAgentPolicyCard.vue';
import en from '@/locales/en';

const URL = '/api/v2/agents/project-policy/p1';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));
const answer = (over = {}) => ({
    project: { done: 'approval', connected: 'single_task' },
    effective: { done: 'approval', connected: 'single_task' },
    workspaceChecksBeforeDone: false,
    canEdit: true,
    ...over,
});

const mountCard = async (data = answer(), onPut = null) => {
    const held = { ...data.project };
    const store = (type, url, body) => ok(answer({ project: Object.assign(held, body) }));
    apiRequest.mockImplementation((type, url, body) => (type === 'get' ? ok(data) : (onPut || store)(type, url, body)));
    const wrapper = mount(ProjectAgentPolicyCard, { props: { projectId: 'p1' }, global: { mocks: { $t: (key) => key } } });
    await flushPromises();
    return wrapper;
};
const radio = (wrapper, name) => wrapper.find(`[data-test="${name}"]`);
const checked = (wrapper) => wrapper.findAll('input[type="radio"]').filter((input) => input.element.checked).map((input) => input.attributes('data-test'));

describe('ProjectAgentPolicyCard', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); });

    it('shows both settings as the project holds them, each choice with its one sentence', async () => {
        const wrapper = await mountCard();
        expect(apiRequest).toHaveBeenCalledWith('get', URL, undefined);
        expect(checked(wrapper)).toEqual(['done-approval', 'connected-single_task']);
        expect(wrapper.findAll('.pap__name').map((node) => node.text())).toEqual([
            'AgentPolicy.done_never', 'AgentPolicy.done_approval', 'AgentPolicy.done_yes',
            'AgentPolicy.connected_propose_all', 'AgentPolicy.connected_single_task',
        ]);
        expect(wrapper.findAll('.pap__about').map((node) => node.text())).toEqual([
            'AgentPolicy.done_never_about', 'AgentPolicy.done_approval_about', 'AgentPolicy.done_yes_about',
            'AgentPolicy.connected_propose_all_about', 'AgentPolicy.connected_single_task_about',
        ]);
        expect(wrapper.find('[data-test="workspace-wins"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(false);
    });

    it('saves one setting the moment it is chosen', async () => {
        const wrapper = await mountCard();
        await radio(wrapper, 'done-never').setValue(true);
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { done: 'never' });
        expect(checked(wrapper)).toEqual(['done-never', 'connected-single_task']);
        expect(toast.success).toHaveBeenCalledTimes(1);

        await radio(wrapper, 'connected-propose_all').setValue(true);
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { connected: 'propose_all' });
        expect(checked(wrapper)).toEqual(['done-never', 'connected-propose_all']);
    });

    it('puts the choice back and says why when the server refuses it', async () => {
        const wrapper = await mountCard(answer(), () => refused('Owner/admin only.'));
        await radio(wrapper, 'done-yes').setValue(true);
        await flushPromises();
        expect(checked(wrapper)).toEqual(['done-approval', 'connected-single_task']);
        expect(wrapper.find('[data-test="error"]').text()).toBe('Owner/admin only.');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('is read-only for someone who may not change it', async () => {
        const wrapper = await mountCard(answer({ canEdit: false }));
        expect(wrapper.findAll('fieldset').every((group) => group.attributes('disabled') !== undefined)).toBe(true);
        expect(wrapper.find('[data-test="read-only"]').text()).toBe('AgentPolicy.read_only');
    });

    it('says so when the workspace switch decides the close', async () => {
        const wrapper = await mountCard(answer({ workspaceChecksBeforeDone: true, effective: { done: 'never', connected: 'single_task' } }));
        expect(wrapper.find('[data-test="workspace-wins"]').text()).toBe('AgentPolicy.workspace_wins');
    });

    it('follows the workspace switch when it is changed elsewhere, and stops listening when it closes', async () => {
        const listeners = {};
        const socket = { on: vi.fn((event, handler) => { listeners[event] = handler; }), off: vi.fn((event, handler) => { if (listeners[event] === handler) delete listeners[event]; }) };
        let data = answer();
        apiRequest.mockImplementation(() => ok(data));
        const wrapper = mount(ProjectAgentPolicyCard, { props: { projectId: 'p1' }, global: { mocks: { $t: (key) => key }, provide: { $socket: ref(socket) } } });
        await flushPromises();
        expect(wrapper.find('[data-test="workspace-wins"]').exists()).toBe(false);

        listeners.agentsChanged({ kind: 'run' });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);

        data = answer({ workspaceChecksBeforeDone: true, effective: { done: 'never', connected: 'single_task' } });
        listeners.agentsChanged({ kind: 'policy' });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(apiRequest).toHaveBeenLastCalledWith('get', URL, undefined);
        expect(wrapper.find('[data-test="workspace-wins"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="loading"]').exists()).toBe(false);

        wrapper.unmount();
        expect(listeners.agentsChanged).toBeUndefined();
    });

    it('shows the reason when the settings cannot be read, and no choices', async () => {
        apiRequest.mockImplementation(() => refused('Project not found.'));
        const wrapper = mount(ProjectAgentPolicyCard, { props: { projectId: 'p1' }, global: { mocks: { $t: (key) => key } } });
        await flushPromises();
        expect(wrapper.find('[data-test="error"]').text()).toBe('Project not found.');
        expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0);
    });

    it('has a sentence in en.js for every string it shows, and the agent settings say a project may be stricter', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/ProjectDetail/ProjectAgentPolicyCard.vue'), 'utf8');
        const keys = [...new Set(source.match(/AgentPolicy\.[a-z_]+/g))];
        expect(keys.length).toBeGreaterThan(15);
        keys.forEach((key) => expect(en.AgentPolicy[key.split('.')[1]], key).toEqual(expect.any(String)));
        const settings = fs.readFileSync(path.resolve(__dirname, '../../src/views/Ai/AgentSettings.vue'), 'utf8');
        expect(settings).toContain("$t('Ai.project_may_be_stricter')");
        expect(en.Ai.project_may_be_stricter).toMatch(/stricter/);
    });

    it('colours with tokens only', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/ProjectDetail/ProjectAgentPolicyCard.vue'), 'utf8');
        const style = source.slice(source.indexOf('<style'));
        expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|--ink-3/i);
    });
});
