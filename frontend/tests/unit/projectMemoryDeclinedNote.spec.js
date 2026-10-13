import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, echo } = vi.hoisted(() => ({ apiRequest: vi.fn(), echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useConvertDate: () => ({ convertDateFormat: (at) => String(at).slice(0, 10) }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));

import ProjectMemoryCard from '@/views/Projects/ProjectDetail/ProjectMemoryCard.vue';

const NOTE_ID = 'project.declined:6f0000000000000000000a11';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const payload = () => ({
    guide: null, assumptions: [], episodes: [],
    rows: [
        { id: 'project.decision:ci-first', kind: 'project.decision', text: 'CI before features', status: 'active', source: { origin: 'owner' }, occurrences: 1 },
        { id: NOTE_ID, kind: 'project.declined', text: 'Ask Mia before posting here', status: 'active', source: { origin: 'proposal.decline', userId: 'u1' }, occurrences: 1, agentName: 'Claude (MCP)' },
    ],
});
const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
const mountCard = async (roleType) => {
    apiRequest.mockImplementation((type) => (type === 'put' ? ok({ id: NOTE_ID, status: 'retired', removed: true }) : ok(payload())));
    const wrapper = mount(ProjectMemoryCard, { props: { projectId: 'p1' }, global: { plugins: [storeFor(roleType)], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};
const noteOf = (wrapper) => wrapper.findAll('[data-test="memory-row"]').find((row) => row.text().includes('Ask Mia'));

describe('a typed decline reason in the project memory list', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('is shown as a declined change, with the agent it was written for and where it came from', async () => {
        const wrapper = await mountCard(3);
        const note = noteOf(wrapper);
        expect(note.text()).toContain('Memory.kind_declined');
        expect(note.text()).toContain('Memory.source_declined');
        expect(note.text()).toContain('Claude (MCP)');
        expect(note.find('[data-test="remove-note"]').exists()).toBe(false);
        expect(note.find('[data-test="edit"]').exists()).toBe(false);
    });

    it('is removed for good by an owner or admin, not retired, and leaves the list', async () => {
        const wrapper = await mountCard(1);
        const note = noteOf(wrapper);
        expect(note.find('[data-test="retire"]').exists()).toBe(false);
        expect(note.find('[data-test="edit"]').exists()).toBe(true);
        await note.find('[data-test="remove-note"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', `/api/v2/agents/memory/${encodeURIComponent(NOTE_ID)}`, { projectId: 'p1', status: 'retired' });
        expect(noteOf(wrapper)).toBeUndefined();
        expect(wrapper.find('[data-test="toggle-retired"]').exists()).toBe(false);
        expect(wrapper.findAll('[data-test="memory-row"]')).toHaveLength(1);
    });
});
