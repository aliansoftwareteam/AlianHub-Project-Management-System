/* Task 010 (29b, 29c): the Table row carries the same Done by badge as List and Board, and the
   sprint report shows who finished what from GET /api/v1/agile/provenance. */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, stub, idle } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    stub: (name) => ({ default: { name, render: () => null } }),
    idle: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => null, getTaskStatus: () => ({ name: 'Done' }) })
}));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: idle }));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({ useTaskCategories: idle }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));

import TableRow from '@/views/Projects/TableView/TableRow.vue';
import ProvenanceRollup from '@/components/molecules/Provenance/ProvenanceRollup.vue';
import { AGILE_PROVENANCE } from '@/config/env';

const store = () => createStore({ getters: { 'users/users': () => [] } });
const at = '2026-09-01T10:00:00Z';

describe('Table row', () => {
    beforeEach(() => { apiRequest.mockResolvedValue({ data: { status: true, data: [] } }); });

    const row = (data) => mount(TableRow, { props: { data: { _id: 't1', TaskName: 'Ship it', statusKey: 1, ...data } }, global: { plugins: [store()] } });

    test('a closed task shows its Done by badge', () => {
        const wrapper = row({
            statusType: 'close',
            completion: { workBy: [{ actorId: 'u2', actorType: 'agent', hours: 1 }], checkedBy: null, closedBy: { actorId: 'u1', actorType: 'human', at } }
        });
        const badge = wrapper.get('.pv-badge');
        expect(badge.text()).toBe('Provenance.badge_unchecked');
        expect(badge.attributes('title')).toBe('Provenance.badge_unchecked_hint');
    });

    test('an open task has no badge', () => {
        expect(row({ statusType: 'active' }).find('.pv-badge').exists()).toBe(false);
    });
});

const ROLLUP = {
    sprint: { id: 's1', name: 'Sprint 7' },
    closed: 8,
    completed: 21,
    unchecked: 1,
    byPattern: {
        HUMAN: { tasks: 4, points: 10, hours: 12 },
        AGENT: { tasks: 2, points: 6, hours: 3 },
        MIXED: { tasks: 1, points: 3, hours: 2 },
        UNCHECKED: { tasks: 1, points: 2, hours: 1 }
    }
};

describe('Sprint provenance rollup', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    const mountRollup = async (props = { sprintId: 's1' }) => {
        const wrapper = mount(ProvenanceRollup, { props });
        await flushPromises();
        return wrapper;
    };

    test('asks the provenance report for the sprint', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: ROLLUP } });
        await mountRollup({ sprintId: 's1' });
        expect(apiRequest).toHaveBeenCalledWith('get', `${AGILE_PROVENANCE}?sprintId=s1`);
    });

    test('renders the counts and shares the endpoint returns, in pattern order', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: ROLLUP } });
        const wrapper = await mountRollup();
        const rows = wrapper.findAll('[data-pattern]');
        expect(rows.map((r) => r.attributes('data-pattern'))).toEqual(['human', 'agent', 'mixed', 'unchecked']);
        expect(rows.map((r) => r.get('.pv-roll__count').text())).toEqual(['4', '2', '1', '1']);
        expect(rows.map((r) => r.get('.pv-roll__pct').text())).toEqual(['50%', '25%', '13%', '13%']);
        expect(wrapper.text()).toContain('Provenance.tasks_closed');
        expect(wrapper.text()).toContain('Provenance.unchecked_line');
        expect(wrapper.get('.pv-roll__bar').attributes('role')).toBe('img');
        expect(wrapper.get('.pv-roll__bar').attributes('aria-label')).toBeTruthy();
    });

    test('a sprint with nothing closed says so instead of drawing an empty bar', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { ...ROLLUP, closed: 0, unchecked: 0, byPattern: {} } } });
        const wrapper = await mountRollup();
        expect(wrapper.text()).toContain('Provenance.empty_title');
        expect(wrapper.find('.pv-roll__bar').exists()).toBe(false);
    });

    test('a refused request shows the server reason', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Sprint not found.' } });
        const wrapper = await mountRollup();
        expect(wrapper.get('[role="alert"]').text()).toBe('Sprint not found.');
        expect(wrapper.find('.pv-roll__bar').exists()).toBe(false);
    });

    test('a failed request shows the load error', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        const wrapper = await mountRollup();
        expect(wrapper.get('[role="alert"]').text()).toBe('Provenance.load_failed');
    });

    test('no sprint, no request', async () => {
        await mountRollup({ sprintId: '' });
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
