import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiHub from '@/views/Ai/AiHub.vue';

const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const AGENT = {
    _id: 'a1', name: 'Reviewer', autonomy: 1, projectIds: ['p1'],
    skills: [{ key: 'pr.summary', name: 'pr.summary', source: 'code' }, { key: 'risk.flags', name: 'risk.flags', source: 'code' }]
};
const REGISTRY = {
    actions: [],
    never: ['project.delete', 'status.set("Done")'],
    autonomy: [0, 1, 2, 3].map((level) => ({ level }))
};

const answer = (url) => {
    if (url === '/api/v2/agents') return [AGENT];
    if (url === '/api/v2/agents/registry') return REGISTRY;
    if (url.startsWith('/api/v2/agents/proposals')) return [];
    return {};
};

const mountHub = async () => {
    apiRequest.mockImplementation((type, url) => Promise.resolve({ data: { status: true, data: answer(url), counts: {} } }));
    const wrapper = mount(AiHub, { global: { plugins: [store, i18n], mocks: { $t: i18n.global.t }, stubs: { 'router-link': { template: '<a><slot /></a>' } } } });
    await flushPromises();
    return wrapper;
};

describe('AI Agents cards in plain words', () => {
    it('says what the agent may do instead of a level code', async () => {
        const wrapper = await mountHub();
        const chip = wrapper.find('[data-test="agent-autonomy"]');
        expect(chip.text()).toBe('Suggests changes');
        expect(chip.attributes('title')).toContain('L1');
        expect(wrapper.find('.ai-grid').text()).not.toMatch(/L1 ·|SUGGEST/);
    });

    it('names the skills in words', async () => {
        const wrapper = await mountHub();
        const chips = wrapper.findAll('.ai-agent__skills .ah-chip').map((c) => c.text());
        expect(chips).toEqual(['Summarise a pull request', 'Flag risks in a pull request']);
    });

    it('says how the agent is started rather than "manual only"', async () => {
        const wrapper = await mountHub();
        expect(wrapper.find('.ai-agent__trigger').text()).toBe('Runs when someone starts it');
    });

    it('lays out the ladder and the never-list in words', async () => {
        const wrapper = await mountHub();
        const ladder = wrapper.find('.ai-ladder').text();
        expect(ladder).toContain('Answers and suggests');
        expect(ladder).toContain('Acts, also on a schedule');
        expect(ladder).not.toMatch(/L[0-3] ·/);
        expect(ladder).toContain('Delete a project');
        expect(ladder).toContain('Mark a task Done');
    });
});
