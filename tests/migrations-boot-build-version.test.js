const fs = require('fs');
const os = require('os');
const path = require('path');

const US = '\x1f';
const RS = '\x1e';
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const MIGRATION_ID = '057-favourites-store';

const created = [];
afterAll(() => created.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function checkout({ git = true, stamp } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-migration-version-'));
    created.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '14.35.0' }));
    if (git) fs.mkdirSync(path.join(dir, '.git'));
    if (stamp) fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify(stamp));
    return dir;
}

const betaGit = async (cwd, args) => {
    if (args[0] === 'describe') return 'v14.35.0';
    if (args[1] === '-1') return `${HEAD}${US}2026-09-28T12:00:00+00:00`;
    return `${HEAD}${US}${'0'.repeat(40)}${US}2026-09-28${US}feat(030): favourites store${US}${RS}`;
};

const slowGit = (ms) => (cwd, args) => new Promise((resolve) => setTimeout(() => resolve(betaGit(cwd, args)), ms));
const silentGit = () => new Promise(() => {});

function boot({ root, run, waitMs }) {
    jest.resetModules();
    const { createResolver } = jest.requireActual('../Config/buildInfo');
    const resolver = createResolver({ root, run, waitMs, onWarning: () => {}, onInfo: () => {} });
    jest.doMock('../Config/buildInfo', () => resolver);
    jest.doMock('../Config/loggerConfig', () => ({ info() {}, warn() {}, error() {} }));
    jest.doMock('../Modules/Instance/health', () => ({ checkDb: async () => ({ ok: true }) }));
    jest.doMock('../utils/mongo-handler/mongoQueries', () => ({
        MongoDbCrudOpration: async () => { throw new Error('no database in this test'); },
    }));
    const { runMigrations, runMigrationsAtBoot } = require('../migrations');
    const { createMemoryStore } = require('../migrations/store');
    const store = createMemoryStore();
    const deps = {
        store,
        migrations: [{ id: MIGRATION_ID, scope: 'company', up: async () => {} }],
        makeContext: () => ({ companies: {} }),
        logger: { info() {}, error() {} },
        owner: 'test',
    };
    resolver.start();
    return { resolver, store, run: () => runMigrationsAtBoot({ auto: true, deps }), runner: () => runMigrations(deps) };
}

describe('migrations applied at server start', () => {
    let resolver;
    afterEach(() => {
        resolver?.stop();
        jest.resetModules();
    });

    it('record the build git reports, not the package.json base, when git answers after the runner starts', async () => {
        const started = boot({ root: checkout(), run: slowGit(40) });
        resolver = started.resolver;
        expect(resolver.get()).toMatchObject({ version: '14.35.0', source: 'git-pending' });

        const result = await started.run();

        expect(result).toMatchObject({ applied: [MIGRATION_ID], failed: null });
        expect(started.store.docs.get(MIGRATION_ID)).toMatchObject({ ok: true, appVersion: '14.36.0-beta.1' });
    });

    it('the runner itself waits for the in-flight git read before recording', async () => {
        const started = boot({ root: checkout(), run: slowGit(40) });
        resolver = started.resolver;

        await started.runner();

        expect(started.store.docs.get(MIGRATION_ID)).toMatchObject({ ok: true, appVersion: '14.36.0-beta.1' });
    });

    it('record the build-info.json stamp when the image has no git checkout', async () => {
        const started = boot({ root: checkout({ git: false, stamp: { version: '14.36.0-beta.603', channel: 'beta' } }), run: silentGit });
        resolver = started.resolver;

        await started.run();

        expect(started.store.docs.get(MIGRATION_ID)).toMatchObject({ ok: true, appVersion: '14.36.0-beta.603' });
    });

    it('stop waiting for a git that never answers and record the package fallback', async () => {
        const started = boot({ root: checkout(), run: silentGit, waitMs: 30 });
        resolver = started.resolver;
        const at = Date.now();

        await started.run();

        expect(Date.now() - at).toBeLessThan(2000);
        expect(started.store.docs.get(MIGRATION_ID)).toMatchObject({ ok: true, appVersion: '14.35.0' });
    });

    it('do not wait for git when nothing is pending', async () => {
        const started = boot({ root: checkout(), run: silentGit, waitMs: 60000 });
        resolver = started.resolver;
        await started.store.put({ _id: MIGRATION_ID, ok: true, appVersion: '14.35.0' });

        const result = await started.run();

        expect(result).toMatchObject({ applied: [], failed: null });
        expect(started.store.docs.get(MIGRATION_ID).appVersion).toBe('14.35.0');
    });
});
