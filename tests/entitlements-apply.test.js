process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mongoose = require('mongoose');
const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));

const MB = 1024 * 1024;
const GB = 1024 * MB;
const hostingMode = require('../Config/hostingMode');
const instanceSettings = require('../Config/instanceSettings');
const { myCache } = require('../Config/config');
const platformState = require('../Modules/Platform/platformState');
const platformEntitlements = require('../Modules/Platform/entitlements');
const instanceSocket = require('../socket/controller/instanceSocket');
const entitlements = require('../Modules/Entitlements/entitlements');
const { planObj } = require('../Modules/Setup/defaultSubscriptionData');

const PRO = {
    instanceId: 'ins_01jd3kabcdefghijklmnopqr',
    version: 7,
    plan: 'pro',
    lifecycle: 'active',
    limits: { seats: 60, guests: null, workspaces: 3, storageBytes: 150 * GB, maxFileBytes: 100 * MB, emailsPerDay: 2000 },
    features: { timeTracker: { enabled: true, seats: 20 }, customDomain: false, ownSmtp: true, sso: false },
    graceUntil: null,
    portalUrl: 'https://account.alianhub.com/i/ins_01jd3k',
};

const saved = { HOSTING_MODE: process.env.HOSTING_MODE };
const everyone = { emit: jest.fn() };
const companyIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
const companies = () => mockDbFor('global').store.companies || [];
let overrides;

const inMode = (mode) => {
    process.env.HOSTING_MODE = mode;
    hostingMode._resetForTests();
};

beforeAll(() => instanceSocket.attach(everyone));

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    companyIds.forEach((_id, i) => mockDbFor('global').seed('companies', { _id, Cst_CompanyName: `W${i}`, planFeature: { ...planObj } }));
    platformState._useStoreForTests(platformState.memoryStore());
    platformEntitlements._resetForTests();
    overrides = jest.spyOn(instanceSettings, 'setOwnershipOverrides').mockImplementation((map) => map);
    everyone.emit.mockClear();
    inMode('managed');
});

afterEach(() => overrides.mockRestore());

afterAll(() => {
    if (saved.HOSTING_MODE === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = saved.HOSTING_MODE;
    hostingMode._resetForTests();
    platformState._useStoreForTests(null);
});

describe('applying an entitlements document', () => {
    it('writes the plan into every workspace, clears the cached companies and tells every browser', async () => {
        myCache.set(`companyData_${companyIds[0]}`, { stale: true });
        myCache.set('instance:public-config', { stale: true });
        await entitlements.applyEntitlements(PRO);
        for (const company of companies()) {
            expect(company.planFeature).toMatchObject({
                users: 60, guestUser: null, bucketStorage: 150 * 1024, maxFileSize: 100, timeTrackerUser: 20, trackerTimesheet: true,
                chat: true, planName: 'enterPrise',
            });
        }
        expect(myCache.get(`companyData_${companyIds[0]}`)).toBeUndefined();
        expect(myCache.get('instance:public-config')).toBeUndefined();
        expect(everyone.emit).toHaveBeenCalledWith('PLAN_UPDATED', expect.objectContaining({ version: 7, plan: 'pro' }));
    });

    it('sets the portal URL and hands mail to the customer only when the plan includes their own SMTP', async () => {
        await entitlements.applyEntitlements(PRO);
        expect(hostingMode.portalUrl()).toBe(PRO.portalUrl);
        expect(overrides).toHaveBeenLastCalledWith({ mail: 'customer' });
        await entitlements.applyEntitlements({ ...PRO, version: 8, features: { ...PRO.features, ownSmtp: false } });
        expect(overrides).toHaveBeenLastCalledWith({});
    });

    it('turns the tracker screens off with the add-on, and keeps its number for the handshake', async () => {
        await entitlements.applyEntitlements({ ...PRO, features: { ...PRO.features, timeTracker: { enabled: false, seats: 0 } } });
        expect(companies()[0].planFeature).toMatchObject({ trackerTimesheet: false, timeTrackerUser: 0 });
    });

    it('is what 062 calls after storing a newer document', async () => {
        await expect(platformEntitlements.applyDownstream({ ...PRO, version: 9, limits: { ...PRO.limits, seats: 70 } })).resolves.toBe(true);
        expect(companies()[1].planFeature.users).toBe(70);
    });

    it('applies the stored document at boot, or the Starter defaults before the first push', async () => {
        await entitlements.bootEntitlements();
        expect(companies()[0].planFeature).toMatchObject({ users: 10, guestUser: 5, bucketStorage: 20 * 1024, maxFileSize: 50, timeTrackerUser: 0, trackerTimesheet: false });
        platformState._useStoreForTests(platformState.memoryStore({ entitlements: { payload: PRO, version: 7 } }));
        await platformEntitlements.loadEntitlements();
        await entitlements.bootEntitlements();
        expect(companies()[0].planFeature.users).toBe(60);
        expect(hostingMode.portalUrl()).toBe(PRO.portalUrl);
    });

    it('gives a workspace created on a hosted instance the plan, not the unlimited default', async () => {
        platformState._useStoreForTests(platformState.memoryStore({ entitlements: { payload: PRO, version: 7 } }));
        await platformEntitlements.loadEntitlements();
        expect(entitlements.planFeatureFor(planObj)).toMatchObject({ users: 60, maxFileSize: 100, chat: true });
    });

    it('reads limits, features and the lifecycle from the document', async () => {
        platformState._useStoreForTests(platformState.memoryStore({ entitlements: { payload: PRO, version: 7 } }));
        await platformEntitlements.loadEntitlements();
        expect(entitlements.limits()).toEqual(PRO.limits);
        expect(entitlements.feature('timeTracker')).toEqual({ enabled: true, seats: 20 });
        expect(entitlements.feature('ownSmtp')).toBe(true);
        expect(entitlements.lifecycle()).toBe('active');
    });
});

describe('self-hosted', () => {
    beforeEach(() => inMode('self'));

    it('applies nothing and every limit is open', async () => {
        await expect(entitlements.applyEntitlements(PRO)).resolves.toEqual({ applied: false });
        expect(companies()[0].planFeature.users).toBeNull();
        expect(entitlements.limits()).toEqual({ seats: null, guests: null, workspaces: null, storageBytes: null, maxFileBytes: null, emailsPerDay: null });
        expect(entitlements.feature('timeTracker')).toEqual({ enabled: true, seats: null });
        expect(entitlements.planFeatureFor(planObj)).toBe(planObj);
        expect(overrides).not.toHaveBeenCalled();
        expect(everyone.emit).not.toHaveBeenCalled();
    });
});
