const fs = require('fs');
const os = require('os');
const path = require('path');
const { createResolver, RETRY_DELAYS_MS } = require('../Config/buildInfo');

const US = '\x1f';
const RS = '\x1e';
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';

const created = [];
afterAll(() => created.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function checkout({ git = true, stamp, version = '14.35.0' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildinfo-resolver-'));
    created.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
    if (git) fs.mkdirSync(path.join(dir, '.git'));
    if (stamp) fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify(stamp));
    return dir;
}

const timedOut = () => Object.assign(new Error('Command failed: git log -1'), { killed: true, signal: 'SIGTERM' });

const betaGit = async (cwd, args) => {
    if (args[0] === 'describe') return 'v14.35.0';
    if (args[1] === '-1') return `${HEAD}${US}2026-09-11T06:00:00+00:00`;
    return `${HEAD}${US}${'0'.repeat(40)}${US}2026-09-11${US}feat(033): honest version${US}${RS}`;
};

function failingThenWorking(failures) {
    let calls = 0;
    return jest.fn(async (cwd, args) => {
        if (args[1] === '-1' && calls++ < failures) throw timedOut();
        return betaGit(cwd, args);
    });
}

const settle = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('running build resolver under a slow git', () => {
    let resolver;
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        resolver?.stop();
        jest.useRealTimers();
    });

    it('reports an unresolved version, not a release label, while git has not answered', () => {
        resolver = createResolver({ root: checkout(), run: () => new Promise(() => {}), onWarning: jest.fn() });
        expect(resolver.get()).toMatchObject({ version: '14.35.0', channel: 'unknown', source: 'git-pending', build: null, commit: null });
    });

    it('a git timeout gives source git-unavailable with the contract fields and one warning', async () => {
        const onWarning = jest.fn();
        resolver = createResolver({ root: checkout(), run: failingThenWorking(Infinity), onWarning, onInfo: jest.fn() });
        const info = await resolver.start();

        expect(info).toEqual({
            version: '14.35.0', release: '14.35.0', base: null, next: null, channel: 'unknown', build: null,
            commit: null, builtAt: null, source: 'git-unavailable', repoUrl: expect.stringMatching(/^https:\/\/github\.com\//), entries: [],
        });
        expect(info.channel).not.toBe('release');
        expect(resolver.summary()).not.toHaveProperty('entries');
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(onWarning.mock.calls[0][0]).toMatch(/timed out after \d+ ms/);
    });

    it('replaces the cached value once a scheduled retry succeeds, and logs the resolved label', async () => {
        const onWarning = jest.fn();
        const onInfo = jest.fn();
        resolver = createResolver({ root: checkout(), run: failingThenWorking(1), onWarning, onInfo });
        await resolver.start();
        expect(resolver.get().source).toBe('git-unavailable');

        await jest.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        await settle();

        expect(resolver.get()).toMatchObject({ version: '14.36.0-beta.1', channel: 'beta', build: 1, commit: 'abcdef12', source: 'git' });
        expect(resolver.summary()).toMatchObject({ version: '14.36.0-beta.1', channel: 'beta' });
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(onInfo).toHaveBeenCalledTimes(1);
        expect(onInfo.mock.calls[0][0]).toContain('14.36.0-beta.1');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('retries after 15 s, 60 s, then every 5 min', async () => {
        const run = failingThenWorking(Infinity);
        const headCalls = () => run.mock.calls.filter(([, args]) => args[1] === '-1').length;
        const onWarning = jest.fn();
        resolver = createResolver({ root: checkout(), run, onWarning, onInfo: jest.fn() });
        await resolver.start();
        expect(RETRY_DELAYS_MS).toEqual([15000, 60000, 300000]);
        expect(headCalls()).toBe(1);

        const expectRetryAfter = async (delay, count) => {
            await jest.advanceTimersByTimeAsync(delay - 1);
            expect(headCalls()).toBe(count - 1);
            await jest.advanceTimersByTimeAsync(1);
            await settle();
            expect(headCalls()).toBe(count);
        };
        await expectRetryAfter(15000, 2);
        await expectRetryAfter(60000, 3);
        await expectRetryAfter(300000, 4);
        await expectRetryAfter(300000, 5);

        expect(resolver.get().source).toBe('git-unavailable');
        expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('never calls git when there is no .git, reading build-info.json and then package.json', async () => {
        const run = jest.fn();
        const stamp = { version: '14.36.0-beta.9', release: '14.35.0', base: '14.35.0', next: '14.36.0', channel: 'beta', build: 9, commit: 'abcdef12', builtAt: '2026-09-11T00:00:00.000Z', source: 'git', repoUrl: 'https://github.com/o/r' };

        resolver = createResolver({ root: checkout({ git: false, stamp }), run });
        expect(await resolver.start()).toEqual({ ...stamp, source: 'stamp', entries: [] });

        resolver = createResolver({ root: checkout({ git: false, version: '9.9.9' }), run });
        expect(resolver.get()).toMatchObject({ version: '9.9.9', channel: 'release', build: 0, source: 'package' });

        expect(run).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});
