const mockEntries = Array.from({ length: 250 }, (_, i) => ({ build: 250 - i, version: `14.36.0-beta.${250 - i}`, date: '2026-09-11', pr: 1000 - i, title: `fix: change ${250 - i}`, type: 'fix', commit: 'abcdef12' }));
const mockBuild = {
    version: '14.36.0-beta.250', release: '14.35.0', base: '14.35.0', next: '14.36.0', channel: 'beta', build: 250,
    commit: '1247dbfe', builtAt: '2026-09-11T06:00:00.000Z', source: 'git', repoUrl: 'https://github.com/o/r', entries: mockEntries,
};

jest.mock('../Config/buildInfo', () => ({
    get: () => mockBuild,
    summary: () => { const info = { ...mockBuild }; delete info.entries; return info; },
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(() => ({ version: '14.36.0' })), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => 4) }));
jest.mock('../Config/instanceSettings', () => ({}));
jest.mock('../Modules/Instance/settingsCatalog', () => ({ GROUPS: [], validateSettings: jest.fn() }));
jest.mock('../Modules/Instance/probes', () => ({ PROBES: {}, STORAGE_ROOT: '/tmp' }));
jest.mock('../Modules/Instance/backups', () => ({}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../migrations', () => ({ migrationStatus: jest.fn(async () => ({ applied: [], pending: [], failed: [] })), liveDeps: jest.fn() }));

const ctrl = require('../Modules/Instance/controller');
const { versionBody } = require('../Modules/Instance/health');

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};

describe('the running build as the Instance console reads it', () => {
    it('stats report the build label, release, commit, channel and number', async () => {
        const res = response();
        await ctrl.stats({}, res);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ version: '14.36.0-beta.250', release: '14.35.0', commit: '1247dbfe', channel: 'beta', build: 250, companies: 4, users: 4 });
        expect(res.body.data.nodeVersion).toBe(process.version);
        expect(typeof res.body.data.uptimeSeconds).toBe('number');
    });

    it('upgrade info shows the label, the build without entries and a capped log, and compares updates to the release', async () => {
        const res = response();
        await ctrl.upgrade({}, res);
        const { data } = res.body;
        expect(data.currentVersion).toBe('14.36.0-beta.250');
        expect(data.release).toBe('14.35.0');
        expect(data.build).toMatchObject({ version: '14.36.0-beta.250', base: '14.35.0', next: '14.36.0', build: 250, commit: '1247dbfe' });
        expect(data.build.entries).toBeUndefined();
        expect(data.buildLog).toHaveLength(200);
        expect(data.buildLog[0]).toEqual(mockEntries[0]);
        expect(data.updateAvailable).toBe(true);
        expect(Array.isArray(data.releases)).toBe(true);
    });

    it('GET /version answers the summary without a database', () => {
        expect(versionBody()).toEqual({ status: true, data: { version: '14.36.0-beta.250', release: '14.35.0', channel: 'beta', build: 250, commit: '1247dbfe' } });
    });
});
