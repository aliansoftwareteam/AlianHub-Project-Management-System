import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));

const TEAM = '/api/v2/agents/team';
const RUNS = '/api/v2/agents/runs';
const PROPOSALS = '/api/v2/agents/proposals';
const HELD = '/api/v2/agents/work-queue/held';

const WORKING = { people: [], agents: [{ id: 'a1', name: 'Reviewer', status: 'running', run: { taskKey: 'AP-1' } }] };
const QUIET = { people: [], agents: [{ id: 'a1', name: 'Reviewer', status: 'idle', run: null }] };

const ok = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
const refused = (retryAfter) => Promise.reject(Object.assign(new Error('Request failed with status code 429'), {
    response: { status: 429, headers: { 'retry-after': String(retryAfter) } }
}));

let world;
const answer = (type, url) => {
    if (url === TEAM) return world.team();
    if (url.startsWith(RUNS)) return ok(world.rows, { summary: { runs: world.open } });
    if (url.startsWith(PROPOSALS)) return ok(world.pending);
    if (url === HELD) return ok(world.held);
    return ok({});
};

const reads = (path) => apiRequest.mock.calls.filter(([, url]) => url.startsWith(path)).length;
const cycles = () => reads(TEAM);

const showTab = (visible) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    document.dispatchEvent(new Event('visibilitychange'));
};

const fakeSocket = () => {
    const handlers = {};
    return {
        on: (event, handler) => { handlers[event] = handler; },
        off: (event) => { delete handlers[event]; },
        fire: (event, payload) => handlers[event]?.(payload)
    };
};

let feed;
let socket;
const releases = [];
const watch = (options) => {
    const release = feed.subscribeAgentFeed(options);
    releases.push(release);
    return release;
};
const settle = () => vi.advanceTimersByTimeAsync(0);
const changed = (times = 1) => { for (let i = 0; i < times; i += 1) socket.fire(feed.AGENTS_CHANGED_EVENT, { kind: 'run' }); };

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    apiRequest.mockReset();
    world = { team: () => ok(WORKING), rows: [], open: [], pending: [], held: [] };
    apiRequest.mockImplementation(answer);
    showTab(true);
    feed = await import('@/views/Ai/agentFeed');
    socket = fakeSocket();
    feed.bindAgentSocket(socket);
});

afterEach(() => {
    releases.splice(0).forEach((release) => release());
    vi.useRealTimers();
});

describe('the shared read of live agents', () => {
    it('asks for the team and the runs once, however many surfaces watch', async () => {
        const seen = [];
        world.rows = [{ _id: 'r1', status: 'running' }];
        watch({ onRuns: (rows) => seen.push(rows) });
        watch({ proposals: true });
        watch();
        await settle();

        expect(reads(TEAM)).toBe(1);
        expect(reads(RUNS)).toBe(1);
        expect(reads(PROPOSALS)).toBe(1);
        expect(seen).toEqual([[{ _id: 'r1', status: 'running' }]]);
        expect(feed.running.value).toBe(1);
    });

    it('leaves the proposals alone until a surface that shows them is watching', async () => {
        watch();
        await settle();
        expect(reads(PROPOSALS)).toBe(0);

        watch({ proposals: true });
        await settle();
        expect(reads(PROPOSALS)).toBe(1);
        expect(cycles()).toBe(1);
    });

    it('marks every read as a background one', async () => {
        watch({ proposals: true });
        await settle();
        expect(apiRequest.mock.calls).toHaveLength(3);
        apiRequest.mock.calls.forEach((call) => {
            expect(call[0]).toBe('get');
            expect(call[4]).toMatchObject({ background: true });
        });
    });

    it('stops when the last watcher leaves', async () => {
        const release = watch();
        await settle();
        release();
        changed(3);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(cycles()).toBe(1);
    });
});

describe('a burst of agent changes', () => {
    it('makes one refresh', async () => {
        watch({ proposals: true });
        await settle();

        changed(20);
        await vi.advanceTimersByTimeAsync(10000);

        expect(reads(TEAM)).toBe(2);
        expect(reads(RUNS)).toBe(2);
        expect(reads(PROPOSALS)).toBe(2);
    });

    it('cannot be held off for ever by changes that keep coming', async () => {
        watch();
        await settle();
        await vi.advanceTimersByTimeAsync(10000);

        for (let i = 0; i < 40; i += 1) {
            changed();
            // eslint-disable-next-line no-await-in-loop
            await vi.advanceTimersByTimeAsync(200);
        }
        expect(cycles()).toBeGreaterThanOrEqual(2);
        expect(cycles()).toBeLessThanOrEqual(3);
    });

    it('starts no second request while one is in flight, then refreshes once', async () => {
        watch();
        await settle();
        await vi.advanceTimersByTimeAsync(10000);

        let land;
        world.team = () => new Promise((resolve) => { land = () => resolve(ok(WORKING)); });
        changed();
        await vi.advanceTimersByTimeAsync(1000);
        expect(cycles()).toBe(2);

        changed(5);
        feed.refreshAgentFeed();
        feed.refreshAgentFeed();
        await vi.advanceTimersByTimeAsync(15000);
        expect(cycles()).toBe(2);

        world.team = () => ok(WORKING);
        land();
        await vi.advanceTimersByTimeAsync(10000);
        expect(cycles()).toBe(3);
    });

    it('follows the socket when the app replaces it', async () => {
        watch();
        await settle();
        const next = fakeSocket();
        feed.bindAgentSocket(next);

        changed(3);
        await vi.advanceTimersByTimeAsync(10000);
        expect(cycles()).toBe(1);

        next.fire(feed.AGENTS_CHANGED_EVENT, { kind: 'proposal' });
        await vi.advanceTimersByTimeAsync(10000);
        expect(cycles()).toBe(2);
    });

    it('hands every caller of refresh the same request', async () => {
        watch();
        await settle();
        const first = feed.refreshAgentFeed();
        const second = feed.refreshAgentFeed();
        expect(second).toBe(first);
        await settle();
        expect(cycles()).toBe(2);
    });
});

describe('the fallback poll', () => {
    it('runs every 30 seconds while an agent works', async () => {
        watch();
        await settle();
        await vi.advanceTimersByTimeAsync(29999);
        expect(cycles()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(cycles()).toBe(2);
        await vi.advanceTimersByTimeAsync(30000);
        expect(cycles()).toBe(3);
    });

    it('keeps that pace while a run waits on a person', async () => {
        world.team = () => ok(QUIET);
        world.open = [{ _id: 'r1', status: 'waiting_approval', taskId: 't1', projectId: 'p1' }];
        watch();
        await settle();
        await vi.advanceTimersByTimeAsync(30000);
        expect(cycles()).toBe(2);
    });

    it('does not keep that pace for a person\'s timer alone', async () => {
        world.team = () => ok({ people: [{ id: 'u1', name: 'Asha', timer: { taskName: 'Write the spec' } }], agents: [] });
        watch();
        await settle();
        await vi.advanceTimersByTimeAsync(119999);
        expect(cycles()).toBe(1);
    });

    it('backs off to every two minutes when nothing runs and nothing waits', async () => {
        world.team = () => ok(QUIET);
        watch({ proposals: true });
        await settle();
        await vi.advanceTimersByTimeAsync(119999);
        expect(cycles()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(cycles()).toBe(2);
        expect(apiRequest.mock.calls).toHaveLength(6);
    });
});

describe('a hidden tab', () => {
    it('asks for nothing, and catches up once when it is shown again', async () => {
        watch({ proposals: true });
        await settle();

        showTab(false);
        changed(10);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(apiRequest.mock.calls).toHaveLength(3);

        showTab(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(apiRequest.mock.calls).toHaveLength(6);
    });

    it('does not start reading when the page opens in the background', async () => {
        showTab(false);
        watch();
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        expect(apiRequest).not.toHaveBeenCalled();

        showTab(true);
        await settle();
        expect(cycles()).toBe(1);
    });
});

describe('a server that answers 429', () => {
    it('is left alone for as long as it asked, without an error reaching anyone', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            watch();
            await settle();

            world.team = () => refused(90);
            await vi.advanceTimersByTimeAsync(30000);
            expect(cycles()).toBe(2);

            world.team = () => ok(WORKING);
            changed(5);
            await vi.advanceTimersByTimeAsync(89000);
            expect(cycles()).toBe(2);

            await vi.advanceTimersByTimeAsync(1000);
            expect(cycles()).toBe(3);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('waits longer each time it is refused again', async () => {
        watch();
        await settle();

        world.team = () => refused(1);
        await vi.advanceTimersByTimeAsync(30000);
        expect(cycles()).toBe(2);
        await vi.advanceTimersByTimeAsync(60000);
        expect(cycles()).toBe(3);
        await vi.advanceTimersByTimeAsync(119999);
        expect(cycles()).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(cycles()).toBe(4);
    });
});

describe('the agent state of one project', () => {
    it('comes out of the shared runs read, with no request of its own', async () => {
        const startedAt = new Date(Date.now() - 120000).toISOString();
        world.open = [
            { _id: 'r1', agentId: 'a1', agentName: 'Reviewer', status: 'running', taskId: 't1', projectId: 'p1', skill: 'code_review', startedAt, spendUsd: 0.25 },
            { _id: 'r2', agentId: 'a2', agentName: 'Planner', status: 'waiting_approval', taskId: 't2', projectId: 'p1', startedAt, spendUsd: 0.5 },
            { _id: 'r3', agentId: 'a3', agentName: 'Elsewhere', status: 'running', taskId: 't9', projectId: 'p2', startedAt, spendUsd: 4 }
        ];
        world.pending = [{ _id: 'pr1', taskId: 't2', projectId: 'p1' }, { _id: 'pr2', taskId: 't9', projectId: 'p2' }];

        watch();
        const { useProjectAgents } = await import('@/views/Projects/Kanban/useProjectAgents');
        const { useProjectAgentActivity } = await import('@/views/Projects/ListView/useProjectAgentActivity.js');
        const board = useProjectAgents();
        const list = useProjectAgentActivity();
        board.start('p1');
        list.load('p1');
        await settle();

        expect(reads(RUNS)).toBe(1);
        expect(reads(PROPOSALS)).toBe(1);
        expect(reads(HELD)).toBe(1);
        expect(apiRequest.mock.calls.some(([, url]) => url.includes('projectId'))).toBe(false);

        expect(board.runFor('t1')).toMatchObject({ agentName: 'Reviewer', skill: 'code_review' });
        expect(board.runFor('t2')).toBeNull();
        expect(board.runFor('t9')).toBeNull();
        expect(board.proposalFor('t2')).toMatchObject({ _id: 'pr1' });
        expect(board.proposalFor('t9')).toBeNull();
        expect(board.summary.value).toMatchObject({ agents: 2, running: 1, waitingApproval: 1, spendUsd: 0.75 });
        expect(board.summary.value.elapsedMs).toBeGreaterThanOrEqual(120000);

        expect(list.runFor('t2')).toMatchObject({ agentName: 'Planner' });
        expect(list.proposalFor('t2')).toMatchObject({ _id: 'pr1' });
        expect(list.runFor('t9')).toBeNull();

        board.start('p2');
        await settle();
        expect(board.runFor('t9')).toMatchObject({ agentName: 'Elsewhere' });
        expect(apiRequest.mock.calls).toHaveLength(4);

        board.stop();
        expect(board.summary.value).toBeNull();
    });
});

describe('the tasks connected agents hold', () => {
    const CLAIM = { taskId: 't1', projectId: 'p1', name: 'Claude, for Priya', since: '2026-10-02T08:42:00.000Z' };

    it('are read only for a surface that shows them, and again when an agent takes or leaves one', async () => {
        watch();
        await settle();
        expect(reads(HELD)).toBe(0);

        world.held = [CLAIM];
        watch({ claims: true });
        await settle();
        expect(reads(HELD)).toBe(1);
        expect(feed.heldTasks.value).toEqual([CLAIM]);

        world.held = [];
        socket.fire(feed.AGENTS_CHANGED_EVENT, { kind: 'claim' });
        await vi.advanceTimersByTimeAsync(6000);
        expect(reads(HELD)).toBe(2);
        expect(feed.heldTasks.value).toEqual([]);
    });

    it('stay empty when the server answers with something that is no list', async () => {
        world.held = { refused: true };
        watch({ claims: true });
        await settle();
        expect(feed.heldTasks.value).toEqual([]);
    });
});
