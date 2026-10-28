const mockCache = new Map();

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/buildInfo', () => ({ get: () => ({ version: '14.41.0-beta.12' }) }));
jest.mock('../Config/config', () => ({
    myCache: {
        get: (key) => mockCache.get(key),
        set: (key, value) => { mockCache.set(key, value); return true; },
        del: (key) => mockCache.delete(key),
    },
}));
jest.mock('../Modules/ScreenshotRetention/helper', () => ({ getCompanyPolicy: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));

const fs = require('fs');
const axios = require('axios');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const retention = require('../Modules/ScreenshotRetention/helper');
const ctrl = require('../Modules/DesktopTracker/controller');
const { trackerAccess } = require('../Modules/DesktopTracker/access');
const hostingMode = require('../Config/hostingMode');

const COMPANY = '6f00000000000000000000c1';
const OTHER_COMPANY = '6f00000000000000000000c2';

const reply = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const run = async (handler, req = {}) => {
    const res = reply();
    await handler({ headers: {}, params: {}, body: {}, query: {}, ...req }, res);
    return res;
};

/* Answers the two company lookups the handshake makes: one with the tracker on, then any company at all. */
const companies = (rows) => {
    MongoDbCrudOpration.mockImplementation(async (db, { data: [filter] }) => {
        const tracked = filter['planFeature.trackerTimesheet'];
        const match = rows.find((row) => !tracked || (row.isDisable !== true && (row.planFeature || {}).trackerTimesheet !== false));
        return match ? { _id: match._id } : null;
    });
};

const savedEnv = { ...process.env };
let readFile;
beforeEach(() => {
    jest.clearAllMocks();
    mockCache.clear();
    hostingMode._resetForTests();
    process.env = { ...savedEnv };
    delete process.env.HOSTING_MODE;
    delete process.env.TRACKER_MIN_VERSION;
    delete process.env.TRACKER_UPDATE_URL;
    delete process.env.PLATFORM_URL;
    process.env.APP_NAME = 'AlianHub';
    readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({ productName: 'Acme' }));
});
afterEach(() => readFile.mockRestore());
afterAll(() => { process.env = savedEnv; });

describe('GET /api/v2/tracker/handshake', () => {
    it('answers a self-hosted instance with its name, logo, version and the tracker on', async () => {
        companies([{ _id: COMPANY, planFeature: { trackerTimesheet: true } }]);
        const res = await run(ctrl.handshake);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            status: true,
            statusText: 'Tracker handshake.',
            data: {
                app: 'alianhub',
                version: '14.41.0-beta.12',
                name: 'Acme',
                logoUrl: '/api/v1/getLogo?key=logo&type=desktop',
                tracker: { enabled: true, minVersion: '6.0.0' },
                managed: false,
            },
        });
    });

    it('says the instance is managed when AlianHub hosts it', async () => {
        process.env.HOSTING_MODE = 'managed';
        companies([{ _id: COMPANY, planFeature: { trackerTimesheet: true } }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.managed).toBe(true);
        expect(res.body.data.tracker.enabled).toBe(true);
    });

    it('turns the tracker off when no workspace has it in its plan', async () => {
        process.env.HOSTING_MODE = 'managed';
        companies([{ _id: COMPANY, planFeature: { trackerTimesheet: false } }, { _id: OTHER_COMPANY, planFeature: { trackerTimesheet: false } }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.tracker.enabled).toBe(false);
    });

    it('keeps the tracker on while any one workspace has it', async () => {
        companies([{ _id: COMPANY, planFeature: { trackerTimesheet: false } }, { _id: OTHER_COMPANY, planFeature: {} }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.tracker.enabled).toBe(true);
    });

    it('does not count a disabled workspace', async () => {
        companies([{ _id: COMPANY, isDisable: true, planFeature: {} }, { _id: OTHER_COMPANY, planFeature: { trackerTimesheet: false } }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.tracker.enabled).toBe(false);
    });

    it('offers the tracker on an instance with no workspace yet', async () => {
        companies([]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.tracker.enabled).toBe(true);
    });

    it('sends the oldest tracker version the server accepts', async () => {
        process.env.TRACKER_MIN_VERSION = '6.2.0';
        companies([{ _id: COMPANY }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.tracker.minVersion).toBe('6.2.0');
    });

    it('falls back to the product name when the brand settings are missing', async () => {
        readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        companies([{ _id: COMPANY }]);
        const res = await run(ctrl.handshake);
        expect(res.body.data.name).toBe('AlianHub');
    });

    it('reveals nothing beyond what the sign-in page shows', async () => {
        companies([{ _id: COMPANY, planFeature: { timeTrackerUser: 20 } }]);
        const res = await run(ctrl.handshake);
        expect(Object.keys(res.body.data).sort()).toEqual(['app', 'logoUrl', 'managed', 'name', 'tracker', 'version']);
        expect(Object.keys(res.body.data.tracker).sort()).toEqual(['enabled', 'minVersion']);
        expect(JSON.stringify(res.body)).not.toContain(COMPANY);
    });

    it('asks the database once a minute at most', async () => {
        companies([{ _id: COMPANY }]);
        await run(ctrl.handshake);
        const calls = MongoDbCrudOpration.mock.calls.length;
        await run(ctrl.handshake);
        expect(MongoDbCrudOpration.mock.calls.length).toBe(calls);
    });

    it('answers 500 without detail when the database fails', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('connection refused at 10.0.0.5'));
        const res = await run(ctrl.handshake);
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    });
});

describe('trackerAccess', () => {
    it.each([
        [undefined, { enabled: true, seatLimit: null }],
        [{}, { enabled: true, seatLimit: null }],
        [{ trackerTimesheet: true, timeTrackerUser: null }, { enabled: true, seatLimit: null }],
        [{ trackerTimesheet: true, timeTrackerUser: 0 }, { enabled: true, seatLimit: null }],
        [{ trackerTimesheet: true, timeTrackerUser: 20 }, { enabled: true, seatLimit: 20 }],
        [{ trackerTimesheet: false, timeTrackerUser: 20 }, { enabled: false, seatLimit: 20 }],
    ])('reads %j as %j', (planFeature, expected) => {
        expect(trackerAccess(planFeature)).toEqual(expected);
    });
});

describe('GET /api/v2/tracker/desktop-app', () => {
    const signedIn = (extra = {}) => ({ headers: { companyid: COMPANY }, aud: COMPANY, uid: 'u1', ...extra });
    const company = (row) => MongoDbCrudOpration.mockResolvedValue({ _id: COMPANY, ...row });
    const manifest = (version, file) => `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: abc==\n    size: 10\npath: ${file}\nsha512: abc==\nreleaseDate: '2026-10-28T10:00:00.000Z'\n`;

    beforeEach(() => {
        retention.getCompanyPolicy.mockResolvedValue({ enabled: true, maxAgeMonths: 3 });
        axios.get.mockImplementation(async (url) => {
            if (url.endsWith('/latest.yml')) return { data: manifest('6.0.2', 'AlianHub-Tracker-Setup-6.0.2.exe') };
            if (url.endsWith('/latest-mac.yml')) return { data: manifest('6.0.2', 'AlianHub-Tracker-6.0.2-universal.dmg') };
            if (url.endsWith('/latest-linux.yml')) return { data: manifest('6.0.2', 'AlianHub-Tracker-6.0.2-x86_64.AppImage') };
            throw new Error('404');
        });
    });

    it('refuses a request for a company the session does not hold', async () => {
        const res = await run(ctrl.desktopApp, signedIn({ headers: { companyid: OTHER_COMPANY } }));
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('shows seats, the current release, screenshot storage and retention', async () => {
        company({ planFeature: { trackerTimesheet: true, timeTrackerUser: 20 }, trackerUsers: 8, trackshotSize: 2150.4 });
        const res = await run(ctrl.desktopApp, signedIn());
        expect(res.statusCode).toBe(200);
        const { data } = res.body;
        expect(data.enabled).toBe(true);
        expect(data.seats).toEqual({ used: 8, limit: 20 });
        expect(data.release.version).toBe('6.0.2');
        expect(data.release.downloads.map((d) => `${d.os}:${d.kind}`)).toEqual(['windows:exe', 'mac:dmg', 'linux:AppImage', 'linux:deb']);
        expect(data.release.downloads[0].url).toBe('https://downloads.alianhub.com/tracker/stable/AlianHub-Tracker-Setup-6.0.2.exe');
        expect(data.screenshots).toEqual({ bytes: Math.round(2150.4 * 1024 * 1024), retention: { enabled: true, maxAgeMonths: 3 } });
        expect(data.portalUrl).toBeNull();
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect([db, method]).toEqual(['global', 'findOne']);
        expect(String(query.data[0]._id)).toBe(COMPANY);
    });

    it('says nothing about storage before the nightly count has run', async () => {
        company({ planFeature: {}, trackerUsers: 0 });
        const res = await run(ctrl.desktopApp, signedIn());
        expect(res.body.data.screenshots.bytes).toBeNull();
        expect(res.body.data.seats).toEqual({ used: 0, limit: null });
    });

    it('offers no download when the plan has no tracker, and links a managed owner to the portal', async () => {
        process.env.HOSTING_MODE = 'managed';
        process.env.PLATFORM_URL = 'https://portal.example.test';
        company({ planFeature: { trackerTimesheet: false } });
        const res = await run(ctrl.desktopApp, signedIn());
        expect(res.body.data.enabled).toBe(false);
        expect(res.body.data.release).toBeNull();
        expect(res.body.data.portalUrl).toBe('https://portal.example.test');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('still answers when the update feed cannot be reached', async () => {
        axios.get.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
        company({ planFeature: {} });
        const res = await run(ctrl.desktopApp, signedIn());
        expect(res.statusCode).toBe(200);
        expect(res.body.data.release).toBeNull();
    });
});
