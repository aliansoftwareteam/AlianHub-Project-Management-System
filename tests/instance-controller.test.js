const mockBuild = {
    version: '14.36.0-beta.9', release: '14.35.0', base: '14.35.0', next: '14.36.0', channel: 'beta', build: 9,
    commit: 'abc1234', builtAt: '2026-09-11T06:00:00.000Z', source: 'git', repoUrl: 'https://github.com/o/r',
    entries: [{ build: 9 }, { build: 8 }],
};

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/buildInfo', () => ({
    get: () => mockBuild,
    summary: () => { const info = { ...mockBuild }; delete info.entries; return info; },
}));
jest.mock('../Config/instanceSettings', () => ({
    describe: jest.fn(() => ({ mail: {} })),
    isLoaded: jest.fn(() => true),
    saveInstanceSettings: jest.fn(),
    publicConfig: jest.fn(),
}));
jest.mock('../Modules/Instance/settingsCatalog', () => ({ GROUPS: [{ key: 'mail' }], validateSettings: jest.fn() }));
jest.mock('../Modules/Instance/probes', () => ({ PROBES: { mail: jest.fn(), storage: jest.fn(), ai: jest.fn() }, STORAGE_ROOT: '/nonexistent-storage-root' }));
jest.mock('../Modules/Instance/health', () => ({ checkDb: jest.fn(), withTimeout: jest.fn() }));
jest.mock('../Modules/Instance/logsPath', () => ({
    LOG_DIR: '/logs',
    KINDS: ['error', 'combined', 'track'],
    listLogFiles: jest.fn(() => []),
    readTail: jest.fn(),
    resolveLogFile: jest.fn(),
}));
jest.mock('../Modules/Instance/backups', () => ({
    BACKUP_DIR: '/backups',
    listBackups: jest.fn(() => []),
    createBackup: jest.fn(),
    resolveBackup: jest.fn(),
    readManifest: jest.fn(),
    restoreBackup: jest.fn(),
    findOrphanDatabases: jest.fn(),
    dropOrphanDatabase: jest.fn(),
    deleteBackup: jest.fn(),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ providerStatus: jest.fn() }));
jest.mock('../Modules/SSO/discover', () => ({ ssoOnInstance: jest.fn() }));
jest.mock('../Modules/Changelog/controller', () => ({ parseChangelog: jest.fn(() => []), withSelfHost: (row) => row }));
jest.mock('../migrations', () => ({
    migrationStatus: jest.fn(),
    liveDeps: jest.fn(() => ({})),
    runMigrations: jest.fn(),
    refreshMigrationState: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { myCache } = require('../Config/config');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const settings = require('../Config/instanceSettings');
const { validateSettings } = require('../Modules/Instance/settingsCatalog');
const { PROBES } = require('../Modules/Instance/probes');
const { checkDb } = require('../Modules/Instance/health');
const logs = require('../Modules/Instance/logsPath');
const backups = require('../Modules/Instance/backups');
const socketEmitter = require('../event/socketEventEmitter');
const llmProvider = require('../Modules/AICore/llmProvider');
const { ssoOnInstance } = require('../Modules/SSO/discover');
const changelog = require('../Modules/Changelog/controller');
const migrations = require('../migrations');
const { state } = require('../Config/instanceState');
const ctrl = require('../Modules/Instance/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const USER = '6f0000000000000000000001';

const reply = () => {
    const res = { statusCode: 200, body: undefined, headers: {}, downloaded: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.setHeader = (key, value) => { res.headers[key] = value; };
    res.download = (file, name) => { res.downloaded = { file, name }; return res; };
    return res;
};
const run = async (handler, req = {}) => {
    const res = reply();
    await handler({ body: {}, query: {}, params: {}, headers: {}, ...req }, res);
    return res;
};

const ENV_KEYS = ['AUTOMATION_QUEUE_DRIVER', 'STORAGE_TYPE', 'RESEND_API_KEY', 'NODEMAILER_HOST', 'WEBURL', 'CRON_ENABLED', 'CRON_TZ', 'MIGRATIONS_AUTO', 'ALIANHUB_DOCKER'];
let savedEnv;
beforeEach(() => {
    jest.clearAllMocks();
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    ENV_KEYS.forEach((key) => delete process.env[key]);
    state.maintenance = false;
    state.migrationError = null;
    migrations.migrationStatus.mockResolvedValue({ applied: [], pending: [], failed: [] });
    settings.describe.mockReturnValue({ mail: {} });
    settings.isLoaded.mockReturnValue(true);
});
afterEach(() => {
    ENV_KEYS.forEach((key) => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
});

describe('access and settings', () => {
    it('access reports how the caller got in', async () => {
        const res = await run(ctrl.access, { instanceAdmin: 'key' });
        expect(res.body).toEqual({ status: true, statusText: 'Instance admin.', data: { allowed: true, via: 'key' } });
    });

    it('getSettings lists the groups, the described settings and whether they are loaded', async () => {
        settings.isLoaded.mockReturnValue(false);
        const res = await run(ctrl.getSettings);
        expect(res.body.data).toEqual({ groups: [{ key: 'mail' }], settings: { mail: {} }, loaded: false });
    });

    it('putSettings answers 400 with the errors and saves nothing when the values are not valid', async () => {
        validateSettings.mockReturnValue({ valid: false, errors: { port: 'must be a number' }, values: {} });
        const res = await run(ctrl.putSettings, { body: { port: 'x' } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'Some settings are not valid.', data: { errors: { port: 'must be a number' } } });
        expect(settings.saveInstanceSettings).not.toHaveBeenCalled();
        expect(validateSettings).toHaveBeenCalledWith({ port: 'x' });
    });

    it('putSettings validates an empty body rather than failing', async () => {
        validateSettings.mockReturnValue({ valid: true, errors: {}, values: {} });
        settings.saveInstanceSettings.mockResolvedValue({ applied: [], restartRequired: [] });
        await run(ctrl.putSettings, { body: undefined });
        expect(validateSettings).toHaveBeenCalledWith({});
    });

    it('putSettings saves as the signed-in user, drops the cached public config and announces the keys', async () => {
        validateSettings.mockReturnValue({ valid: true, errors: {}, values: { a: 1 } });
        settings.saveInstanceSettings.mockResolvedValue({ applied: ['a'], restartRequired: [] });
        const res = await run(ctrl.putSettings, { uid: USER, instanceAdmin: 'owner', body: { a: 1 } });
        expect(settings.saveInstanceSettings).toHaveBeenCalledWith({ a: 1 }, USER);
        expect(myCache.del).toHaveBeenCalledWith('instance:public-config');
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', { module: 'instanceSettings', event: 'INSTANCE_SETTINGS_UPDATED', keys: ['a'] });
        expect(res.body.statusText).toBe('Saved.');
        expect(res.body.data).toEqual({ applied: ['a'], restartRequired: [], settings: { mail: {} } });
    });

    it('putSettings records the admin key as the author when there is no user, and says a restart is needed', async () => {
        validateSettings.mockReturnValue({ valid: true, errors: {}, values: { a: 1 } });
        settings.saveInstanceSettings.mockResolvedValue({ applied: ['a'], restartRequired: ['a'] });
        const res = await run(ctrl.putSettings, { instanceAdmin: 'key', body: { a: 1 } });
        expect(settings.saveInstanceSettings).toHaveBeenCalledWith({ a: 1 }, 'key');
        expect(res.body.statusText).toBe('Saved. Restart the server to apply the marked settings.');
    });

    it('putSettings answers 500 with the reason and neither clears the cache nor emits when the save fails', async () => {
        validateSettings.mockReturnValue({ valid: true, errors: {}, values: {} });
        settings.saveInstanceSettings.mockRejectedValue(new Error('disk full'));
        const res = await run(ctrl.putSettings, { body: {} });
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ status: false, statusText: 'disk full' });
        expect(myCache.del).not.toHaveBeenCalled();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });
});

describe('testSettings', () => {
    it.each([[undefined], [''], ['sms'], [null]])('answers 400 for the group %j and probes nothing', async (group) => {
        const res = await run(ctrl.testSettings, { body: { group, values: {} } });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toContain('Nothing to test for');
        Object.values(PROBES).forEach((probe) => expect(probe).not.toHaveBeenCalled());
    });

    it.failing('answers 400 for the group "__proto__" (it reads the probe off Object.prototype and throws)', async () => {
        const res = await run(ctrl.testSettings, { body: { group: '__proto__', values: {} } });
        expect(res.statusCode).toBe(400);
    });

    it('answers 400 when the request has no body at all', async () => {
        const res = await run(ctrl.testSettings, { body: undefined });
        expect(res.statusCode).toBe(400);
    });

    it('runs the probe of the group with the plain values only, dropping masked objects', async () => {
        PROBES.mail.mockResolvedValue({ status: true, statusText: 'sent', data: { id: 1 } });
        const res = await run(ctrl.testSettings, { body: { group: 'mail', values: { host: 'smtp.x', password: { masked: true }, port: 25, empty: null } } });
        expect(PROBES.mail).toHaveBeenCalledWith({ host: 'smtp.x', port: 25, empty: null });
        expect(res.body).toEqual({ status: true, statusText: 'sent', data: { group: 'mail', id: 1 } });
    });

    it('adds the group to the answer of a probe that returns no data and probes with no values', async () => {
        PROBES.ai.mockResolvedValue({ status: false, statusText: 'no key' });
        const res = await run(ctrl.testSettings, { body: { group: 'ai' } });
        expect(PROBES.ai).toHaveBeenCalledWith({});
        expect(res.body).toEqual({ status: false, statusText: 'no key', data: { group: 'ai' } });
    });
});

describe('publicConfig', () => {
    const payload = { auth: { sso: false, google: true }, brand: 'x' };

    it('builds the config once and caches it for a minute', async () => {
        myCache.get.mockReturnValue(undefined);
        settings.publicConfig.mockReturnValue(payload);
        const res = await run(ctrl.publicConfig);
        expect(res.body).toEqual({ status: true, statusText: 'Public config.', data: payload });
        expect(myCache.set).toHaveBeenCalledWith('instance:public-config', payload, 60);
    });

    it('uses the cached config without building it again', async () => {
        myCache.get.mockReturnValue(payload);
        await run(ctrl.publicConfig);
        expect(settings.publicConfig).not.toHaveBeenCalled();
        expect(myCache.set).not.toHaveBeenCalled();
    });

    it('does not ask the SSO discovery when the instance switched SSO off', async () => {
        myCache.get.mockReturnValue(payload);
        const res = await run(ctrl.publicConfig);
        expect(ssoOnInstance).not.toHaveBeenCalled();
        expect(res.body.data.auth.sso).toBe(false);
    });

    it('offers SSO only when switched on and discovery finds one, leaving the cached object alone', async () => {
        const cached = { auth: { sso: true } };
        myCache.get.mockReturnValue(cached);
        ssoOnInstance.mockResolvedValue(true);
        expect((await run(ctrl.publicConfig)).body.data.auth.sso).toBe(true);
        ssoOnInstance.mockResolvedValue(false);
        expect((await run(ctrl.publicConfig)).body.data.auth.sso).toBe(false);
        expect(cached.auth.sso).toBe(true);
    });

    it('says SSO is not offered when discovery throws', async () => {
        myCache.get.mockReturnValue({ auth: { sso: true } });
        ssoOnInstance.mockRejectedValue(new Error('db down'));
        const res = await run(ctrl.publicConfig);
        expect(res.body.data.auth.sso).toBe(false);
    });
});

describe('health', () => {
    beforeEach(() => {
        process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
        process.env.STORAGE_TYPE = 'wasabi';
        checkDb.mockResolvedValue({ ok: true, latencyMs: 3 });
        PROBES.storage.mockResolvedValue({ status: true, statusText: 'reachable' });
        backups.listBackups.mockReturnValue([]);
    });

    it('reports ok with the database, storage, mail and agenda sections', async () => {
        const res = await run(ctrl.health);
        const { data } = res.body;
        expect(data.status).toBe('ok');
        expect(data.version).toBe('14.36.0-beta.9');
        expect(data.db).toEqual({ ok: true, latencyMs: 3 });
        expect(data.storage).toEqual({ type: 'wasabi', ok: true, detail: 'reachable' });
        expect(data.agenda).toEqual({ driver: 'inline' });
        expect(data.maintenance).toBe(false);
        expect(data.lastBackup).toBeNull();
    });

    it('reports degraded when the database is down', async () => {
        checkDb.mockResolvedValue({ ok: false, error: 'no ping' });
        const res = await run(ctrl.health);
        expect(res.body.data.status).toBe('degraded');
    });

    it('names the mail provider from the environment without probing by default', async () => {
        const none = await run(ctrl.health);
        expect(none.body.data.mail).toEqual({ configured: false, provider: null });
        process.env.NODEMAILER_HOST = 'smtp.x';
        expect((await run(ctrl.health)).body.data.mail).toEqual({ configured: true, provider: 'smtp' });
        process.env.RESEND_API_KEY = 're_x';
        expect((await run(ctrl.health)).body.data.mail).toEqual({ configured: true, provider: 'resend' });
        expect(PROBES.mail).not.toHaveBeenCalled();
    });

    it('sends a probe mail only when asked with probe=mail', async () => {
        process.env.RESEND_API_KEY = 're_x';
        PROBES.mail.mockResolvedValue({ status: false, statusText: 'rejected' });
        const res = await run(ctrl.health, { query: { probe: 'mail' } });
        expect(res.body.data.mail).toEqual({ configured: true, provider: 'resend', ok: false, detail: 'rejected' });
        await run(ctrl.health, { query: { probe: 'other' } });
        expect(PROBES.mail).toHaveBeenCalledTimes(1);
    });

    it('computes the readiness checklist', async () => {
        backups.listBackups.mockReturnValue([{ name: 'b1' }]);
        process.env.WEBURL = 'https://hub.example';
        process.env.RESEND_API_KEY = 're_x';
        const ready = (await run(ctrl.health)).body.data.readiness;
        expect(ready).toEqual({ mailConfigured: true, storageChosen: true, backupTaken: true, httpsWebUrl: true, migrationsClean: true });

        backups.listBackups.mockReturnValue([]);
        process.env.WEBURL = 'http://hub.example';
        delete process.env.RESEND_API_KEY;
        delete process.env.STORAGE_TYPE;
        state.migrationError = 'boom';
        const notReady = (await run(ctrl.health)).body.data.readiness;
        expect(notReady).toEqual({ mailConfigured: false, storageChosen: false, backupTaken: false, httpsWebUrl: false, migrationsClean: false });
    });

    it('lists pending migrations by id and survives a failing migration lookup', async () => {
        migrations.migrationStatus.mockResolvedValue({ applied: ['a'], pending: [{ id: 'm2' }], failed: [] });
        const ok = await run(ctrl.health);
        expect(ok.body.data.migrations).toMatchObject({ applied: 1, pending: ['m2'], failed: [] });
        expect(ok.body.data.readiness.migrationsClean).toBe(false);

        migrations.migrationStatus.mockRejectedValue(new Error('no db'));
        const broken = await run(ctrl.health);
        expect(broken.body.data.migrations.applied).toBe(0);
        expect(broken.body.data.readiness.migrationsClean).toBe(true);
    });

    it('reports the cron settings from the environment', async () => {
        process.env.CRON_ENABLED = 'false';
        process.env.CRON_TZ = 'Asia/Kolkata';
        const res = await run(ctrl.health);
        expect(res.body.data.cron).toMatchObject({ enabled: false, tz: 'Asia/Kolkata' });
    });
});

describe('setMaintenance', () => {
    it.each([[true, true], ['true', true], [false, false], ['false', false], ['yes', false], [1, false], [undefined, false]])('turns maintenance to the right state for on=%j', async (on, expected) => {
        state.maintenance = !expected;
        const res = await run(ctrl.setMaintenance, { body: { on } });
        expect(state.maintenance).toBe(expected);
        expect(res.body.data).toEqual({ maintenance: expected });
        expect(res.body.statusText).toBe(expected ? 'Maintenance mode is on.' : 'Maintenance mode is off.');
    });

    it('switches maintenance off for a request with no body', async () => {
        state.maintenance = true;
        await run(ctrl.setMaintenance, { body: undefined });
        expect(state.maintenance).toBe(false);
    });
});

describe('upgrade', () => {
    const cachedLatest = (version) => myCache.get.mockImplementation((key) => (key === 'instance:latest-release' ? { version, url: 'https://r' } : undefined));

    it('says an update is available when the latest release is newer than the running one', async () => {
        cachedLatest('14.36.0');
        const res = await run(ctrl.upgrade);
        expect(res.body.data.updateAvailable).toBe(true);
        expect(res.body.data.latest.version).toBe('14.36.0');
    });

    it.each([['14.35.0'], ['v14.35.0'], ['14.34.9'], ['13.99.99']])('says no update for the latest release %s', async (latest) => {
        cachedLatest(latest);
        expect((await run(ctrl.upgrade)).body.data.updateAvailable).toBe(false);
    });

    it('compares versions numerically, so 14.100.0 is newer than 14.36.0', async () => {
        mockBuild.release = '14.36.0';
        cachedLatest('14.100.0');
        expect((await run(ctrl.upgrade)).body.data.updateAvailable).toBe(true);
        mockBuild.release = '14.35.0';
    });

    it('says no update when the release lookup failed', async () => {
        myCache.get.mockImplementation((key) => (key === 'instance:latest-release' ? { error: 'offline' } : undefined));
        const res = await run(ctrl.upgrade);
        expect(res.body.data.updateAvailable).toBe(false);
        expect(res.body.data.latest).toEqual({ error: 'offline' });
    });

    it('asks GitHub once, caches a good answer for six hours and strips the v from the tag', async () => {
        myCache.get.mockReturnValue(undefined);
        axios.get.mockResolvedValue({ data: { tag_name: 'v14.40.0', html_url: 'https://r/40', published_at: '2026-09-01', name: 'Forty' } });
        const res = await run(ctrl.upgrade);
        expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest$/), expect.objectContaining({ timeout: 8000 }));
        const release = { version: '14.40.0', url: 'https://r/40', publishedAt: '2026-09-01', name: 'Forty' };
        expect(myCache.set).toHaveBeenCalledWith('instance:latest-release', release, 6 * 3600);
        expect(res.body.data.latest).toEqual(release);
        expect(res.body.data.updateAvailable).toBe(true);
    });

    it('remembers a failed lookup for ten minutes and still answers', async () => {
        myCache.get.mockReturnValue(undefined);
        axios.get.mockRejectedValue(new Error('offline'));
        const res = await run(ctrl.upgrade);
        expect(myCache.set).toHaveBeenCalledWith('instance:latest-release', { error: 'offline' }, 600);
        expect(res.body.status).toBe(true);
        expect(res.body.data.updateAvailable).toBe(false);
    });

    it('lists only releases newer than the running one and flags the ones needing hands', async () => {
        cachedLatest('14.35.0');
        changelog.parseChangelog.mockReturnValue([
            { version: '14.36.0', selfHost: { upgradeNeeded: true } },
            { version: '14.35.0' },
            { version: '14.34.0', selfHost: { breaking: true } },
            { version: '15.0.0' },
        ]);
        const res = await run(ctrl.upgrade);
        expect(res.body.data.releases.map((r) => r.version)).toEqual(['14.36.0', '15.0.0']);
        expect(res.body.data.upgradeNeedsHands).toBe(true);

        changelog.parseChangelog.mockReturnValue([{ version: '14.36.0', selfHost: {} }]);
        expect((await run(ctrl.upgrade)).body.data.upgradeNeedsHands).toBe(false);
    });

    it('reports the migration state, the auto flag and the docker flag', async () => {
        cachedLatest('14.35.0');
        process.env.ALIANHUB_DOCKER = '1';
        process.env.MIGRATIONS_AUTO = 'false';
        state.migrationError = 'm1 failed';
        migrations.migrationStatus.mockResolvedValue({ applied: ['a'], pending: [], failed: [] });
        const { data } = (await run(ctrl.upgrade)).body;
        expect(data.migrations).toEqual({ applied: ['a'], pending: [], failed: [], auto: false, error: 'm1 failed' });
        expect(data.docker).toBe(true);
        expect(data.buildLog).toEqual(mockBuild.entries);
    });
});

describe('runMigrations', () => {
    it('applies the pending migrations, refreshes the state and clears the stored error', async () => {
        state.migrationError = 'old';
        migrations.runMigrations.mockResolvedValue({ applied: ['a', 'b'], failed: null });
        migrations.refreshMigrationState.mockResolvedValue({ pending: [] });
        const res = await run(ctrl.runMigrations);
        expect(res.body.statusText).toBe('Applied 2.');
        expect(res.body.data).toEqual({ applied: ['a', 'b'], failed: null, status: { pending: [] } });
        expect(state.migrationError).toBeNull();
    });

    it('records the failing migration and says which one failed', async () => {
        migrations.runMigrations.mockResolvedValue({ applied: [], failed: { id: 'm9', error: 'bad index' } });
        migrations.refreshMigrationState.mockResolvedValue({});
        const res = await run(ctrl.runMigrations);
        expect(res.body.statusText).toBe('m9 failed.');
        expect(state.migrationError).toBe('m9: bad index');
    });

    it('answers 500 with the reason when the run throws', async () => {
        migrations.runMigrations.mockRejectedValue(new Error('no lock'));
        const res = await run(ctrl.runMigrations);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ status: false, statusText: 'no lock' });
    });
});

describe('logs', () => {
    it('listLogs returns the directory and files', async () => {
        logs.listLogFiles.mockReturnValue([{ name: 'error-2026-01-01.log' }]);
        const res = await run(ctrl.listLogs);
        expect(res.body.data).toEqual({ dir: '/logs', files: [{ name: 'error-2026-01-01.log' }] });
    });

    it('tailLog reads the error log by default, 500 lines', async () => {
        logs.readTail.mockResolvedValue({ file: 'error-x.log', lines: ['a'] });
        const res = await run(ctrl.tailLog);
        expect(logs.readTail).toHaveBeenCalledWith('error', 500);
        expect(res.body.data).toEqual({ kind: 'error', file: 'error-x.log', lines: ['a'] });
    });

    it.each([['../etc/passwd'], ['audit'], ['ERROR'], ['error,combined']])('answers 400 for the log kind %j and reads nothing', async (file) => {
        const res = await run(ctrl.tailLog, { query: { file } });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('file must be one of error, combined, track.');
        expect(logs.readTail).not.toHaveBeenCalled();
    });

    it.each([['0', 500], ['-4', 1], ['abc', 500], ['999999', 5000], ['50', 50], ['', 500]])('clamps lines=%j to %i', async (lines, expected) => {
        logs.readTail.mockResolvedValue({ lines: [] });
        await run(ctrl.tailLog, { query: { file: 'track', lines } });
        expect(logs.readTail).toHaveBeenCalledWith('track', expected);
    });

    it('tailLog answers 500 with the reason when reading fails', async () => {
        logs.readTail.mockRejectedValue(new Error('EACCES'));
        const res = await run(ctrl.tailLog, { query: { file: 'combined' } });
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('EACCES');
    });

    it('downloadLog sends the resolved file under its own name', async () => {
        logs.resolveLogFile.mockReturnValue('/logs/error-2026-01-01.log');
        const res = await run(ctrl.downloadLog, { query: { name: 'error-2026-01-01.log' } });
        expect(logs.resolveLogFile).toHaveBeenCalledWith('error-2026-01-01.log');
        expect(res.downloaded).toEqual({ file: '/logs/error-2026-01-01.log', name: 'error-2026-01-01.log' });
    });

    it('downloadLog answers 404 for a name that resolves to nothing', async () => {
        logs.resolveLogFile.mockReturnValue(null);
        const res = await run(ctrl.downloadLog, { query: { name: '../../etc/passwd' } });
        expect(res.statusCode).toBe(404);
        expect(res.body.statusText).toBe('No such log file.');
        expect(res.downloaded).toBeUndefined();
    });
});

describe('backups', () => {
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-ctrl-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('createBackup includes files only when asked with true or "true"', async () => {
        backups.createBackup.mockResolvedValue({ name: 'b1' });
        const cases = [[true, true], ['true', true], ['yes', false], [1, false], [undefined, false]];
        for (const [includeFiles, expected] of cases) {
            await run(ctrl.createBackup, { body: { includeFiles } });
            expect(backups.createBackup).toHaveBeenLastCalledWith({ includeFiles: expected });
        }
        const res = await run(ctrl.createBackup, { body: undefined });
        expect(res.body).toEqual({ status: true, statusText: 'Backup b1 written.', data: { name: 'b1' } });
    });

    it('createBackup answers 500 with the reason when it fails', async () => {
        backups.createBackup.mockRejectedValue(new Error('no space'));
        const res = await run(ctrl.createBackup);
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('no space');
    });

    it('listBackups returns the directory and the backups', async () => {
        backups.listBackups.mockReturnValue([{ name: 'b1' }]);
        expect((await run(ctrl.listBackups)).body.data).toEqual({ dir: '/backups', backups: [{ name: 'b1' }] });
    });

    it('downloadBackup sends an existing backup under its own name', async () => {
        const file = path.join(dir, 'b1.tar.gz');
        fs.writeFileSync(file, 'x');
        backups.resolveBackup.mockReturnValue(file);
        const res = await run(ctrl.downloadBackup, { params: { name: 'b1.tar.gz' } });
        expect(backups.resolveBackup).toHaveBeenCalledWith('b1.tar.gz');
        expect(res.downloaded).toEqual({ file, name: 'b1.tar.gz' });
    });

    it.each([['an unresolved name', null], ['a file that is gone', '/nonexistent/b1.tar.gz']])('downloadBackup and backupManifest answer 404 for %s', async (_label, resolved) => {
        backups.resolveBackup.mockReturnValue(resolved);
        const download = await run(ctrl.downloadBackup, { params: { name: 'x' } });
        expect(download.statusCode).toBe(404);
        expect(download.body.statusText).toBe('No such backup.');
        const manifest = await run(ctrl.backupManifest, { params: { name: 'x' } });
        expect(manifest.statusCode).toBe(404);
        expect(backups.readManifest).not.toHaveBeenCalled();
    });

    it('backupManifest returns the manifest, or 400 with the reason when it cannot be read', async () => {
        const file = path.join(dir, 'b1.tar.gz');
        fs.writeFileSync(file, 'x');
        backups.resolveBackup.mockReturnValue(file);
        backups.readManifest.mockResolvedValueOnce({ format: 'alianhub-backup' });
        const ok = await run(ctrl.backupManifest, { params: { name: 'b1.tar.gz' } });
        expect(ok.body).toEqual({ status: true, statusText: 'Backup manifest.', data: { format: 'alianhub-backup' } });
        expect(backups.readManifest).toHaveBeenCalledWith(file);

        backups.readManifest.mockRejectedValueOnce(new Error('corrupt'));
        const bad = await run(ctrl.backupManifest, { params: { name: 'b1.tar.gz' } });
        expect(bad.statusCode).toBe(400);
        expect(bad.body.statusText).toBe('Could not read the backup: corrupt');
    });

    it('restoreBackup passes the name and the typed confirmation as a string', async () => {
        backups.restoreBackup.mockResolvedValue({ restored: 3 });
        const res = await run(ctrl.restoreBackup, { params: { name: 'b1' }, body: { confirm: 'RESTORE' } });
        expect(backups.restoreBackup).toHaveBeenCalledWith({ name: 'b1', confirm: 'RESTORE' });
        expect(res.body).toEqual({ status: true, statusText: 'Restore finished.', data: { restored: 3 } });

        await run(ctrl.restoreBackup, { params: { name: 'b1' }, body: undefined });
        expect(backups.restoreBackup).toHaveBeenLastCalledWith({ name: 'b1', confirm: '' });
    });

    it('restoreBackup answers 400 for a missing confirmation or backup and 500 for anything else', async () => {
        backups.restoreBackup.mockRejectedValueOnce(new Error('Type RESTORE to confirm'));
        expect((await run(ctrl.restoreBackup, { params: { name: 'b1' } })).statusCode).toBe(400);
        backups.restoreBackup.mockRejectedValueOnce(new Error('No such backup'));
        expect((await run(ctrl.restoreBackup, { params: { name: 'b1' } })).statusCode).toBe(400);
        backups.restoreBackup.mockRejectedValueOnce(new Error('mongorestore failed'));
        const res = await run(ctrl.restoreBackup, { params: { name: 'b1' } });
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('mongorestore failed');
    });

    it('deleteBackup deletes by name and answers 404 when it cannot', async () => {
        const ok = await run(ctrl.deleteBackup, { params: { name: 'b1' } });
        expect(backups.deleteBackup).toHaveBeenCalledWith('b1');
        expect(ok.body).toEqual({ status: true, statusText: 'Backup deleted.', data: { name: 'b1' } });

        backups.deleteBackup.mockImplementationOnce(() => { throw new Error('No such backup'); });
        const gone = await run(ctrl.deleteBackup, { params: { name: 'b2' } });
        expect(gone.statusCode).toBe(404);
        expect(gone.body.statusText).toBe('No such backup');
    });
});

describe('orphan databases', () => {
    it('lists the orphaned databases, or answers 500 with the reason', async () => {
        backups.findOrphanDatabases.mockResolvedValueOnce([{ name: COMPANY }]);
        expect((await run(ctrl.orphanDatabases)).body.data).toEqual({ databases: [{ name: COMPANY }] });
        backups.findOrphanDatabases.mockRejectedValueOnce(new Error('no db'));
        const res = await run(ctrl.orphanDatabases);
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('no db');
    });

    it('drops the named database with the typed confirmation', async () => {
        backups.dropOrphanDatabase.mockResolvedValue({ name: COMPANY });
        const res = await run(ctrl.dropOrphanDatabase, { params: { name: COMPANY }, body: { confirm: COMPANY } });
        expect(backups.dropOrphanDatabase).toHaveBeenCalledWith({ name: COMPANY, confirm: COMPANY });
        expect(res.body).toEqual({ status: true, statusText: `Database ${COMPANY} dropped.`, data: { name: COMPANY } });
        await run(ctrl.dropOrphanDatabase, { params: { name: COMPANY }, body: undefined });
        expect(backups.dropOrphanDatabase).toHaveBeenLastCalledWith({ name: COMPANY, confirm: '' });
    });

    it('relays the status code of a refusal and answers 500 for an unexpected failure', async () => {
        backups.dropOrphanDatabase.mockRejectedValueOnce(Object.assign(new Error('Not an orphan'), { statusCode: 409 }));
        const refused = await run(ctrl.dropOrphanDatabase, { params: { name: COMPANY } });
        expect(refused.statusCode).toBe(409);
        expect(refused.body.statusText).toBe('Not an orphan');
        backups.dropOrphanDatabase.mockRejectedValueOnce(new Error('drop failed'));
        expect((await run(ctrl.dropOrphanDatabase, { params: { name: COMPANY } })).statusCode).toBe(500);
    });
});

describe('stats and companies', () => {
    it('stats counts companies and users in the global database', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(7).mockResolvedValueOnce(42);
        const res = await run(ctrl.stats);
        expect(res.body.data).toMatchObject({ companies: 7, users: 42, version: '14.36.0-beta.9' });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: 'companies', data: [{}] }, 'countDocuments');
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: 'users', data: [{}] }, 'countDocuments');
    });

    it('stats shows 0 for a count that comes back empty and answers 500 when a count fails', async () => {
        MongoDbCrudOpration.mockResolvedValue(undefined);
        expect((await run(ctrl.stats)).body.data).toMatchObject({ companies: 0, users: 0 });
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run(ctrl.stats);
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('db down');
    });

    it('companies lists the newest 500 with only name and creation date, from the global database', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ Cst_CompanyName: 'Acme' }]);
        const res = await run(ctrl.companies);
        expect(res.body).toEqual({ status: true, statusText: 'Companies fetched.', data: [{ Cst_CompanyName: 'Acme' }] });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', {
            type: 'companies',
            data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1 }, limit: 500 }],
        }, 'find');
    });

    it('companies answers an empty list for no rows and 500 when the read fails', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        expect((await run(ctrl.companies)).body.data).toEqual([]);
        MongoDbCrudOpration.mockRejectedValueOnce(new Error('db down'));
        expect((await run(ctrl.companies)).statusCode).toBe(500);
    });
});

describe('auditExport', () => {
    const asOwner = (over = {}) => ({ instanceAdmin: 'owner', uid: USER, aud: COMPANY, headers: { companyid: COMPANY }, query: {}, body: {}, ...over });
    const lines = (res) => res.body.replace(/^﻿/, '').split('\r\n');

    it('reads the history of the named company, newest first, capped at 50000 rows', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        await run(ctrl.auditExport, asOwner({ query: { companyId: OTHER_COMPANY } }));
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(OTHER_COMPANY, {
            type: 'history',
            data: [{}, 'Type Key UserId ProjectId TaskId Message createdAt', { sort: { createdAt: -1 }, limit: 50000 }],
        }, 'find');
    });

    it('falls back to the company of the verified header when none is named', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        await run(ctrl.auditExport, asOwner());
        expect(MongoDbCrudOpration.mock.calls[0][0]).toBe(COMPANY);
    });

    it('filters by the from and to dates, inclusive', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        await run(ctrl.auditExport, asOwner({ query: { from: '2026-01-01', to: '2026-02-01' } }));
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ createdAt: { $gte: new Date('2026-01-01'), $lte: new Date('2026-02-01') } });
        await run(ctrl.auditExport, asOwner({ query: { from: '2026-01-01' } }));
        expect(MongoDbCrudOpration.mock.calls[1][1].data[0]).toEqual({ createdAt: { $gte: new Date('2026-01-01') } });
    });

    it.each([['from', 'yesterday'], ['to', 'not-a-date']])('answers 400 for an invalid %s date and reads nothing', async (key, value) => {
        const res = await run(ctrl.auditExport, asOwner({ query: { [key]: value } }));
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('from/to must be valid dates.');
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([['abc'], ['6f0000000000000000000c0'], ['6f0000000000000000000c011'], ['../../etc']])('answers 400 for the company id %j', async (companyId) => {
        const res = await run(ctrl.auditExport, asOwner({ query: { companyId } }));
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('companyId is required.');
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 403 to a signed-out caller with no company named', async () => {
        const res = await run(ctrl.auditExport, { headers: { companyid: COMPANY }, query: {} });
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, statusText: 'You do not have access to this company' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 403 when no company is named and the header is not a company id', async () => {
        const res = await run(ctrl.auditExport, asOwner({ headers: { companyid: 'nope' } }));
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('writes a BOM, a header row and one row per entry as a CSV attachment', async () => {
        MongoDbCrudOpration.mockResolvedValue([
            { createdAt: new Date('2026-01-02T03:04:05Z'), Type: 'task', Key: 'task_create', UserId: USER, ProjectId: 'p1', TaskId: 't1', Message: 'Created' },
        ]);
        const res = await run(ctrl.auditExport, asOwner());
        expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
        expect(res.headers['Content-Disposition']).toBe(`attachment; filename="audit-${COMPANY}.csv"`);
        expect(res.body.startsWith('﻿')).toBe(true);
        expect(lines(res)).toEqual([
            'CreatedAt,Type,Key,UserId,ProjectId,TaskId,Message',
            `2026-01-02T03:04:05.000Z,task,task_create,${USER},p1,t1,Created`,
        ]);
    });

    it('writes only the header row for no history, whether the read returns an empty list or nothing', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([]);
        expect(lines(await run(ctrl.auditExport, asOwner()))).toEqual(['CreatedAt,Type,Key,UserId,ProjectId,TaskId,Message']);
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        expect(lines(await run(ctrl.auditExport, asOwner()))).toHaveLength(1);
    });

    it('strips HTML, quotes commas and quotes, and keeps a spreadsheet from running a formula', async () => {
        MongoDbCrudOpration.mockResolvedValue([
            { Message: '<b>Bold</b> said "hi", ok', Type: '=HYPERLINK("x")', Key: '@sum', UserId: null },
        ]);
        const row = lines(await run(ctrl.auditExport, asOwner()))[1];
        expect(row).toBe(',"\'=HYPERLINK(""x"")",\'@sum,,,,"Bold said ""hi"", ok"');
    });

    it('answers 500 with the reason when the read fails', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run(ctrl.auditExport, asOwner());
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('db down');
    });
});

describe('aiProviders', () => {
    it('adds this node\'s host name to the provider status', async () => {
        llmProvider.providerStatus.mockReturnValue({ providers: [{ id: 'a' }] });
        const res = await run(ctrl.aiProviders);
        expect(res.body).toEqual({ status: true, statusText: 'AI providers.', data: { node: os.hostname(), providers: [{ id: 'a' }] } });
    });

    it('answers 500 with the reason when the status cannot be read', async () => {
        llmProvider.providerStatus.mockImplementation(() => { throw new Error('registry gone'); });
        const res = await run(ctrl.aiProviders);
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('registry gone');
    });
});
