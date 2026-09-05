import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));

import { NEW_AGENT_DEFAULTS, canRevertRun, reasonOf, refusalCount, runOf, useAgents } from '@/views/Ai/useAgents';
import { useParity } from '@/views/Ai/useParity';

const okResponse = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
const httpError = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

describe('reasonOf', () => {
    it('prefers the API refusal over the axios status message', () => {
        expect(reasonOf(httpError(409, 'Agent is paused (manual).'), 'Ai.run_failed')).toBe('Agent is paused (manual).');
    });

    it('never surfaces "Request failed with status code"', () => {
        const bare = Object.assign(new Error('Request failed with status code 500'), { response: { data: {} } });
        expect(reasonOf(bare, 'Ai.run_failed')).toBe('t:Ai.run_failed');
    });

    it('keeps a meaningful thrown message', () => {
        expect(reasonOf(new Error('Network Error'), 'Ai.run_failed')).toBe('Network Error');
    });
});

describe('refusalCount', () => {
    it('reads the number the server stores and tolerates the old array shape', () => {
        expect(refusalCount({ refusals: 3 })).toBe(3);
        expect(refusalCount({ refusals: [1, 2] })).toBe(2);
        expect(refusalCount({})).toBe(0);
    });
});

describe('useAgents', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('throws the API reason from a 409 on setPaused, pauseAll, runNow and decide', async () => {
        const { setPaused, pauseAll, runNow, decide } = useAgents();
        apiRequest.mockImplementation(() => Promise.reject(httpError(409, 'Spend cap reached ($30.00 of $30).')));
        await expect(setPaused('a1', true)).rejects.toThrow('Spend cap reached ($30.00 of $30).');
        await expect(pauseAll()).rejects.toThrow('Spend cap reached ($30.00 of $30).');
        await expect(runNow('a1', 't1')).rejects.toThrow('Spend cap reached ($30.00 of $30).');
        await expect(decide('p1', 'approve')).rejects.toThrow('Spend cap reached ($30.00 of $30).');
    });

    it('starts a manual run on the chosen task', async () => {
        const { runNow } = useAgents();
        apiRequest.mockImplementation((type, url) => (type === 'post' ? okResponse({ _id: 'r1' }) : okResponse(url.includes('summary') ? { running: 1 } : [])));
        const run = await runNow('a1', 't1');
        expect(run).toEqual({ _id: 'r1' });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs', { agentId: 'a1', taskId: 't1', trigger: 'manual' });
    });

    it('maps inbox counts to what the API sends and filters the done view by status', async () => {
        const { loadProposals, proposals, counts, waiting } = useAgents();
        apiRequest.mockImplementation((type, url) => okResponse(
            url.includes('status=all')
                ? [{ _id: '1', status: 'approved' }, { _id: '2', status: 'edited' }, { _id: '3', status: 'declined' }, { _id: '4', status: 'pending' }]
                : [{ _id: '4', status: 'pending' }],
            { counts: { waiting: 1, doneByAi: 2, declined: 1, undone: 0 } }
        ));
        await loadProposals('pending');
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v2/agents/proposals?status=pending');
        expect(waiting.value).toBe(1);
        expect(counts.value.doneByAi).toBe(2);

        await loadProposals('done');
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v2/agents/proposals?status=all&limit=200');
        expect(proposals.value.map((p) => p._id)).toEqual(['1', '2']);

        await loadProposals('declined');
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v2/agents/proposals?status=declined');
    });

    it('deletes an agent through the DELETE route and reports the refusal', async () => {
        const { deleteAgent } = useAgents();
        apiRequest.mockImplementation((type) => (type === 'delete' ? Promise.reject(httpError(409, 'Stop the running run first.')) : okResponse([])));
        await expect(deleteAgent('a1')).rejects.toThrow('Stop the running run first.');
        expect(apiRequest).toHaveBeenCalledWith('delete', '/api/v2/agents/a1', undefined);
    });
});

describe('NEW_AGENT_DEFAULTS', () => {
    it('starts a new agent at L1 Suggest', () => {
        expect(NEW_AGENT_DEFAULTS.autonomy).toBe(1);
    });
});

describe('runOf', () => {
    it('unwraps the { run, audit } answer of GET /runs/:id and passes a bare run through', () => {
        expect(runOf({ run: { _id: 'r1', decisions: [] }, audit: [{ id: 'a' }] })).toEqual({ _id: 'r1', decisions: [], audit: [{ id: 'a' }] });
        expect(runOf({ _id: 'r2' })).toEqual({ _id: 'r2' });
        expect(runOf(null)).toBeNull();
    });
});

describe('canRevertRun', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const later = new Date(now + 3600e3).toISOString();
    const earlier = new Date(now - 3600e3).toISOString();
    const done = { status: 'done', startedBy: 'u1', windowEndsAt: later };

    it('lets an owner/admin or the starter revert inside the window', () => {
        expect(canRevertRun(done, { userId: 'u9', privileged: true, now })).toBe(true);
        expect(canRevertRun(done, { userId: 'u1', privileged: false, now })).toBe(true);
        expect(canRevertRun(done, { userId: 'u9', privileged: false, now })).toBe(false);
    });

    it('refuses once the window closed, the run was reverted, or it is still running', () => {
        expect(canRevertRun({ ...done, windowEndsAt: earlier }, { privileged: true, now })).toBe(false);
        expect(canRevertRun({ ...done, revertedAt: earlier }, { privileged: true, now })).toBe(false);
        expect(canRevertRun({ ...done, status: 'running' }, { privileged: true, now })).toBe(false);
        expect(canRevertRun(null, { privileged: true, now })).toBe(false);
    });

    it('leaves the window to the server when the payload carries none', () => {
        expect(canRevertRun({ status: 'failed', startedBy: 'u1' }, { userId: 'u1', now })).toBe(true);
    });
});

describe('useAgents run detail', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('loads one run with its decisions', async () => {
        const { loadRun } = useAgents();
        apiRequest.mockImplementation(() => okResponse({ run: { _id: 'r1', decisions: [{ action: 'task.comment', decision: 'act', reason: 'reversible' }] }, audit: [] }));
        const run = await loadRun('r1');
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/runs/r1', undefined);
        expect(run.decisions).toHaveLength(1);
    });

    it('reverts through POST /runs/:id/revert and hands back the report', async () => {
        const { revertRun } = useAgents();
        apiRequest.mockImplementation(() => okResponse({ reverted: 5, failed: [{ action: 'chat.post', reason: 'no undo' }], windowEndsAt: '2026-09-06T12:00:00Z' }));
        const out = await revertRun('r1');
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs/r1/revert', {});
        expect(out).toEqual({ reverted: 5, failed: [{ action: 'chat.post', reason: 'no undo' }], windowEndsAt: '2026-09-06T12:00:00Z' });
    });

    it('surfaces the server statusText when the window has closed', async () => {
        const { revertRun } = useAgents();
        apiRequest.mockImplementation(() => Promise.reject(httpError(409, 'The undo window closed 2 hours ago.')));
        await expect(revertRun('r1')).rejects.toThrow('The undo window closed 2 hours ago.');
    });
});

describe('useParity.startRun', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('carries the picker options and surfaces the API reason', async () => {
        const { startRun } = useParity();
        apiRequest.mockImplementation((type) => (type === 'post' ? okResponse({ _id: 'r2' }) : okResponse([])));
        await startRun({ agentId: 'a1', taskId: 't1', trigger: 'assignment', notifyMe: true, spendCapUsd: 2 });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs', { agentId: 'a1', taskId: 't1', note: undefined, trigger: 'assignment', spendCapUsd: 2, notifyMe: true });

        apiRequest.mockImplementation(() => Promise.reject(httpError(403, 'This agent is not scoped to that project.')));
        await expect(startRun({ agentId: 'a1', taskId: 't1' })).rejects.toThrow('This agent is not scoped to that project.');
    });
});
