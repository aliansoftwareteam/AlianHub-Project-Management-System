import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));

import ProjectMemoryCard from '@/views/Projects/ProjectDetail/ProjectMemoryCard.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const httpError = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

const payload = {
    guide: {
        stages: [{ name: 'Discover', goal: 'Know the users' }, { name: 'Build', goal: '' }],
        essentials: ['Budget sign-off'],
        escalations: ['Legal questions'],
        markdown: '## Stages\n1. **Discover**'
    },
    assumptions: [{ point: '1', text: 'Two engineers full time' }],
    rows: [
        { id: 'project.constraint:budget', kind: 'project.constraint', text: 'Budget is fixed at 12k', status: 'active', source: { origin: 'brief' }, occurrences: 2 },
        { id: 'project.decision:ci-first', kind: 'project.decision', text: 'CI before features', status: 'active', source: { origin: 'proposal.approve' }, occurrences: 1 },
        { id: 'project.decision:old', kind: 'project.decision', text: 'Old idea', status: 'retired', source: { origin: 'owner' }, occurrences: 1 }
    ],
    episodes: [{ runId: 'r1', skill: 'project.guide', taskTitle: 'Set up CI', summary: 'proposed 3, approved 2', at: '2026-09-09T10:00:00Z' }]
};
const newRow = { id: 'project.constraint:ship-q4', kind: 'project.constraint', text: 'Ship in Q4', status: 'active', source: { origin: 'owner' }, occurrences: 1 };

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const answerWith = (data) => (type) => {
    if (type === 'post') return ok(newRow);
    if (type === 'put') return ok({});
    return ok(data);
};

const mountCard = async ({ roleType = 3, data = payload, answer = answerWith(data) } = {}) => {
    apiRequest.mockImplementation(answer);
    const wrapper = mount(ProjectMemoryCard, { props: { projectId: 'p1' }, global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

const rowsOf = (wrapper) => wrapper.findAll('[data-test="memory-row"]');

describe('ProjectMemoryCard', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('loads the project memory and renders guide, assumptions, rows with source chips and recent runs', async () => {
        const wrapper = await mountCard();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/memory/project/p1', undefined);

        const guide = wrapper.find('[data-test="guide"]');
        expect(guide.findAll('.pm__stages li')).toHaveLength(2);
        expect(guide.text()).toContain('Discover');
        expect(guide.text()).toContain('Know the users');
        expect(guide.text()).toContain('Budget sign-off');
        expect(guide.text()).toContain('Legal questions');
        expect(guide.find('details').exists()).toBe(true);

        expect(wrapper.find('[data-test="assumptions"]').text()).toContain('Two engineers full time');

        const rows = rowsOf(wrapper);
        expect(rows).toHaveLength(2);
        expect(rows[0].find('[data-test="source"]').text()).toBe('Memory.source_brief');
        expect(rows[0].find('.ah-chip').classes()).toContain('ah-chip--warn');
        expect(rows[1].find('[data-test="source"]').text()).toBe('Memory.source_approved');
        expect(rows[1].find('.ah-chip').classes()).toContain('ah-chip--brand');

        const episodes = wrapper.find('[data-test="episodes"]');
        expect(episodes.findAll('.pm__episode')).toHaveLength(1);
        expect(episodes.text()).toContain('project.guide');
        expect(episodes.text()).toContain('Set up CI');
        expect(wrapper.find('[data-test="empty"]').exists()).toBe(false);
    });

    it('hides retired rows behind the toggle', async () => {
        const wrapper = await mountCard();
        const toggle = wrapper.find('[data-test="toggle-retired"]');
        expect(toggle.text()).toBe('Memory.show_retired');
        await toggle.trigger('click');
        expect(rowsOf(wrapper)).toHaveLength(3);
        expect(rowsOf(wrapper)[2].attributes('data-status')).toBe('retired');
        expect(rowsOf(wrapper)[2].classes()).toContain('is-retired');
        expect(wrapper.find('[data-test="toggle-retired"]').text()).toBe('Memory.hide_retired');
    });

    it('gives owners and admins edit, retire and add; a member reads only', async () => {
        const member = await mountCard({ roleType: 3 });
        expect(member.find('[data-test="add"]').exists()).toBe(false);
        expect(member.find('[data-test="edit"]').exists()).toBe(false);
        expect(member.find('[data-test="retire"]').exists()).toBe(false);

        for (const roleType of [1, 2]) {
            // eslint-disable-next-line no-await-in-loop
            const wrapper = await mountCard({ roleType });
            expect(wrapper.find('[data-test="add"]').exists()).toBe(true);
            expect(wrapper.findAll('[data-test="edit"]')).toHaveLength(2);
            expect(wrapper.findAll('[data-test="retire"]')).toHaveLength(2);
        }
    });

    it('posts the kind and text from the add form and appends the answer', async () => {
        const wrapper = await mountCard({ roleType: 1 });
        await wrapper.find('[data-test="add"]').trigger('click');
        const form = wrapper.find('[data-test="add-form"]');
        expect(form.find('[data-test="add-save"]').attributes('disabled')).toBeDefined();

        await form.find('[data-test="add-kind"]').setValue('project.constraint');
        await form.find('[data-test="add-text"]').setValue('  Ship in Q4  ');
        expect(form.find('[data-test="add-save"]').attributes('disabled')).toBeUndefined();
        await form.trigger('submit');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/memory/project/p1', { kind: 'project.constraint', text: 'Ship in Q4' });
        expect(wrapper.find('[data-test="add-form"]').exists()).toBe(false);
        expect(rowsOf(wrapper)).toHaveLength(3);
        expect(rowsOf(wrapper)[2].text()).toContain('Ship in Q4');
    });

    it('edits a row inline and retires one, both scoped to the project', async () => {
        const wrapper = await mountCard({ roleType: 2 });
        await rowsOf(wrapper)[0].find('[data-test="edit"]').trigger('click');
        await wrapper.find('[data-test="edit-text"]').setValue('Budget is fixed at 15k');
        await wrapper.find('[data-test="edit-save"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/project.constraint%3Abudget', { scopeId: 'p1', text: 'Budget is fixed at 15k' });
        expect(wrapper.find('[data-test="edit-text"]').exists()).toBe(false);
        expect(rowsOf(wrapper)[0].text()).toContain('Budget is fixed at 15k');

        await rowsOf(wrapper)[1].find('[data-test="retire"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/project.decision%3Aci-first', { scopeId: 'p1', status: 'retired' });
        expect(rowsOf(wrapper)).toHaveLength(1);
        expect(wrapper.find('[data-test="toggle-retired"]').exists()).toBe(true);
    });

    it('shows the server refusal on a failed save and keeps the row', async () => {
        const wrapper = await mountCard({
            roleType: 1,
            answer: (type) => (type === 'put' ? Promise.reject(httpError(409, 'Owner only.')) : ok(payload))
        });
        await rowsOf(wrapper)[0].find('[data-test="retire"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('Owner only.');
        expect(rowsOf(wrapper)).toHaveLength(2);
    });

    it('shows the empty state with retry when the load fails, then recovers', async () => {
        let fail = true;
        const wrapper = await mountCard({ answer: () => (fail ? Promise.reject(httpError(503, 'Memory is unavailable')) : ok(payload)) });
        const empty = wrapper.find('.empty-state');
        expect(empty.exists()).toBe(true);
        expect(empty.text()).toContain('Memory.load_failed');
        expect(empty.text()).toContain('Memory is unavailable');
        expect(rowsOf(wrapper)).toHaveLength(0);

        fail = false;
        await empty.find('.empty-state__btn').trigger('click');
        await flushPromises();
        expect(wrapper.find('.empty-state').exists()).toBe(false);
        expect(rowsOf(wrapper)).toHaveLength(2);
    });

    it('says quietly that nothing is stored yet', async () => {
        const wrapper = await mountCard({ data: { guide: null, assumptions: [], rows: [], episodes: [] } });
        expect(wrapper.find('[data-test="empty"]').text()).toBe('Memory.empty');
        expect(wrapper.find('[data-test="rows"]').exists()).toBe(false);
        expect(wrapper.find('.empty-state').exists()).toBe(false);
    });
});
