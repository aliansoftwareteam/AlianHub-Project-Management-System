import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));

import { useProjectMemory } from '@/views/Ai/useProjectMemory';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.resolve({ data: { status: false, statusText } });
const httpError = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

const row = (id, extra = {}) => ({ id, kind: 'project.decision', text: id, status: 'active', source: { origin: 'brief' }, occurrences: 1, ...extra });

describe('useProjectMemory', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('loads the four parts and normalises string assumptions', async () => {
        apiRequest.mockImplementation(() => ok({
            guide: { stages: [{ name: 'Discover' }], essentials: [], escalations: [] },
            assumptions: ['Two engineers', { point: '2', text: 'No design help' }, null],
            rows: [row('a')],
            episodes: [{ runId: 'r1', skill: 'project.guide', at: '2026-09-09T10:00:00Z' }]
        }));
        const memory = useProjectMemory();
        const done = memory.load('p1');
        expect(memory.loading.value).toBe(true);
        await done;
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/memory/project/p1', undefined);
        expect(memory.loading.value).toBe(false);
        expect(memory.error.value).toBe('');
        expect(memory.guide.value.stages[0].name).toBe('Discover');
        expect(memory.assumptions.value).toEqual([{ text: 'Two engineers' }, { point: '2', text: 'No design help' }]);
        expect(memory.rows.value).toHaveLength(1);
        expect(memory.episodes.value[0].runId).toBe('r1');
    });

    it('tolerates an empty answer', async () => {
        apiRequest.mockImplementation(() => ok(null));
        const memory = useProjectMemory();
        await memory.load('p1');
        expect(memory.guide.value).toBeNull();
        expect(memory.rows.value).toEqual([]);
        expect(memory.error.value).toBe('');
    });

    it('keeps the API refusal as the error and falls back to the locale key', async () => {
        const memory = useProjectMemory();
        apiRequest.mockImplementation(() => Promise.reject(httpError(403, 'No access to this project.')));
        await memory.load('p1');
        expect(memory.error.value).toBe('No access to this project.');

        apiRequest.mockImplementation(() => Promise.reject(Object.assign(new Error('Request failed with status code 500'), { response: { data: {} } })));
        await memory.load('p1');
        expect(memory.error.value).toBe('t:Memory.load_failed');

        apiRequest.mockImplementation(() => refused('Memory is off for this workspace.'));
        await memory.load('p1');
        expect(memory.error.value).toBe('Memory is off for this workspace.');
    });

    it('keeps the answer of the latest load when an earlier one lands last', async () => {
        const pending = {};
        apiRequest.mockImplementation((type, url) => new Promise((resolve) => { pending[url] = resolve; }));
        const memory = useProjectMemory();
        const first = memory.load('A');
        const second = memory.load('B');
        pending['/api/v2/agents/memory/project/B']({ data: { status: true, data: { rows: [row('b')] } } });
        await second;
        expect(memory.rows.value.map((r) => r.id)).toEqual(['b']);
        expect(memory.loading.value).toBe(false);

        pending['/api/v2/agents/memory/project/A']({ data: { status: true, data: { rows: [row('a')] } } });
        await first;
        expect(memory.rows.value.map((r) => r.id)).toEqual(['b']);
        expect(memory.loading.value).toBe(false);
        expect(memory.error.value).toBe('');
    });

    it('ignores a failure from a superseded load', async () => {
        const pending = {};
        apiRequest.mockImplementation((type, url) => new Promise((resolve, reject) => { pending[url] = { resolve, reject }; }));
        const memory = useProjectMemory();
        const first = memory.load('A');
        const second = memory.load('B');
        pending['/api/v2/agents/memory/project/B'].resolve({ data: { status: true, data: { rows: [row('b')] } } });
        await second;
        pending['/api/v2/agents/memory/project/A'].reject(httpError(403, 'No access to this project.'));
        await first;
        expect(memory.error.value).toBe('');
        expect(memory.rows.value.map((r) => r.id)).toEqual(['b']);
    });

    it('replaces the row in place when an edit re-keys it', async () => {
        apiRequest.mockImplementation((type) => (type === 'put'
            ? ok({ id: 'project.decision:ship-in-q4', text: 'Ship in Q4', status: 'active' })
            : ok({ rows: [row('project.decision:ship-in-march'), row('b')] })));
        const memory = useProjectMemory();
        await memory.load('p1');
        const updated = await memory.updateRow('project.decision:ship-in-march', { projectId: 'p1', text: 'Ship in Q4' });
        expect(updated).toMatchObject({ id: 'project.decision:ship-in-q4', text: 'Ship in Q4', kind: 'project.decision' });
        expect(memory.rows.value.map((r) => r.id)).toEqual(['project.decision:ship-in-q4', 'b']);
    });

    it('posts a new row and appends the answer', async () => {
        apiRequest.mockImplementation((type) => (type === 'post' ? ok(row('project.constraint:budget', { kind: 'project.constraint', text: 'Budget is fixed' })) : ok({ rows: [row('a')] })));
        const memory = useProjectMemory();
        await memory.load('p1');
        const added = await memory.addRow('p1', { kind: 'project.constraint', text: 'Budget is fixed' });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/memory/project/p1', { kind: 'project.constraint', text: 'Budget is fixed' });
        expect(added.text).toBe('Budget is fixed');
        expect(memory.rows.value.map((r) => r.id)).toEqual(['a', 'project.constraint:budget']);
    });

    it('sends only the given fields on update and merges the answer into the row', async () => {
        apiRequest.mockImplementation((type) => (type === 'put' ? ok({ id: 'a', text: 'Renamed', lastSeenAt: '2026-09-10T00:00:00Z' }) : ok({ rows: [row('a'), row('b')] })));
        const memory = useProjectMemory();
        await memory.load('p1');
        const updated = await memory.updateRow('a', { projectId: 'p1', text: 'Renamed' });
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/a', { projectId: 'p1', text: 'Renamed' });
        expect(updated).toMatchObject({ id: 'a', text: 'Renamed', status: 'active', lastSeenAt: '2026-09-10T00:00:00Z' });
        expect(memory.rows.value[1].id).toBe('b');
    });

    it('retires through the same endpoint with the status and encodes the id', async () => {
        apiRequest.mockImplementation((type) => (type === 'put' ? ok({}) : ok({ rows: [row('project.decision:ci-first')] })));
        const memory = useProjectMemory();
        await memory.load('p1');
        await memory.retireRow('project.decision:ci-first', 'p1');
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/project.decision%3Aci-first', { projectId: 'p1', status: 'retired' });
        expect(memory.rows.value[0].status).toBe('retired');
    });

    it('throws the refusal from a failed write and leaves the rows alone', async () => {
        apiRequest.mockImplementation((type) => (type === 'put' ? Promise.reject(httpError(409, 'Owner only.')) : ok({ rows: [row('a')] })));
        const memory = useProjectMemory();
        await memory.load('p1');
        await expect(memory.retireRow('a', 'p1')).rejects.toThrow('Owner only.');
        expect(memory.rows.value[0].status).toBe('active');
    });
});
