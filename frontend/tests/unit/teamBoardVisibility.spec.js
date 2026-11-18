import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { echo, apiRequest } = vi.hoisted(() => ({
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    apiRequest: vi.fn(),
}));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('@/services', () => ({ apiRequest }));

import TeamPage from '@/views/Team/TeamPage.vue';

const person = (over = {}) => ({
    kind: 'person', id: 'u1', name: 'Olivia Owner', status: 'working', pto: null, openTasks: 1,
    timer: { taskId: 't1', taskName: 'Ship it', hidden: false, elapsedMs: 600000 }, nowOn: 'Ship it', nowOnHidden: false,
    loggedHours: 3, load: 8, ...over,
});

const mountWith = async (data) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: { agents: [], activity: [], standup: { lines: [], balance: { over: [], free: [] } }, ...data } } });
    const wrapper = mount(TeamPage, { global: { mocks: { $t: echo }, stubs: { ShellIcon: true, AgentIdentity: true } } });
    await flushPromises();
    return wrapper;
};

describe('TeamPage when the viewer may not see a task or hours', () => {
    it('shows a neutral line and no timer for a task the viewer cannot open, and no load for hidden hours', async () => {
        const wrapper = await mountWith({
            people: [person({ timer: { taskId: '', taskName: '', hidden: true, elapsedMs: null }, nowOn: '', nowOnHidden: true, loggedHours: null, load: null })],
            totals: { people: 1, agents: 0, load: null },
        });
        expect(wrapper.find('.team__now').text()).toBe('Parity.busy_on_task');
        expect(wrapper.find('.team__timer').exists()).toBe(false);
        expect(wrapper.find('.team__load').text()).toBe('Parity.hours_not_shared');
        expect(wrapper.find('.team__bar').exists()).toBe(false);
        expect(wrapper.find('.parity-count').text()).toBe('Parity.team_headline_no_load {"p":1,"a":0,"load":0}');
    });

    it('still shows the task, timer and load when the viewer may see them', async () => {
        const wrapper = await mountWith({ people: [person()], totals: { people: 1, agents: 0, load: 8 } });
        expect(wrapper.find('.team__now').text()).toContain('Ship it');
        expect(wrapper.find('.team__timer').text()).toBe('00:10');
        expect(wrapper.find('.team__load-num').text()).toBe('8%');
        expect(wrapper.find('.parity-count').text()).toBe('Parity.team_headline {"p":1,"a":0,"load":8}');
    });

    it('says an agent is busy without naming a hidden task', async () => {
        const wrapper = await mountWith({
            people: [],
            agents: [{ kind: 'agent', id: 'a1', name: 'Coder', paused: false, status: 'running', spend: { usd: 0, cap: 0, runs: 0 },
                       run: { id: '', status: 'running', taskId: '', taskKey: '', taskName: '', hidden: true, elapsedMs: 120000 } }],
            totals: { people: 0, agents: 1, load: 0 },
        });
        expect(wrapper.find('.team__row--agent .team__now').text()).toBe('Parity.agent_on {"task":"Parity.busy_on_task","min":2}');
    });
});
