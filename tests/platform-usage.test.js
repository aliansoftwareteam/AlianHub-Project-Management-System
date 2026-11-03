const mongoose = require('mongoose');
const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));

const { SEAT_ACTIVE, SEAT_PENDING, SEAT_CANCELLED } = require('../Config/seatStatus');
const { ROLE_GUEST, ROLE_MEMBER, ROLE_ADMIN } = require('../Config/roleTypes');
const { state: instanceState } = require('../Config/instanceState');
const platformState = require('../Modules/Platform/platformState');
const usage = require('../Modules/Platform/usage');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-02T10:05:00Z');
const id = () => new mongoose.Types.ObjectId().toHexString();

describe('counting seats', () => {
    const seat = (userId, extra = {}) => ({ userId, userEmail: `${userId}@acme.test`, status: SEAT_ACTIVE, roleType: ROLE_MEMBER, ...extra });

    it('counts a person once across workspaces', () => {
        expect(usage.countSeats([[seat('a'), seat('b')], [seat('a')]])).toMatchObject({ active: 2, pending: 0, guests: 0 });
    });

    it('counts as a guest only someone who is a guest everywhere', () => {
        const rows = [[seat('g', { roleType: ROLE_GUEST }), seat('m', { roleType: ROLE_GUEST })], [seat('m')]];
        expect(usage.countSeats(rows)).toMatchObject({ active: 2, guests: 1 });
    });

    it('counts invitations to addresses that hold no live seat', () => {
        const rows = [[seat('a'), { userEmail: 'new@acme.test', status: SEAT_PENDING }, { userEmail: 'A@acme.test', status: SEAT_PENDING }], [{ userEmail: 'new@acme.test', status: SEAT_PENDING }]];
        expect(usage.countSeats(rows)).toMatchObject({ active: 1, pending: 1 });
    });

    it('leaves out the support account and counts tracker seats', () => {
        const rows = [[seat('a', { isTrackerUser: true }), seat('s'), seat('b', { isTrackerUser: true })], [seat('a', { isTrackerUser: true })]];
        expect(usage.countSeats(rows, ['s'])).toEqual({ active: 2, pending: 0, guests: 0, trackerSeats: 2 });
    });
});

describe('the usage report', () => {
    const world = () => {
        const companies = Array.from({ length: 10 }, (_, i) => ({ _id: id(), Cst_CompanyName: `Workspace ${i}` }));
        companies.forEach((company) => mockDbFor('global').seed('companies', company));
        mockDbFor('global').seed('companies', { _id: id(), Cst_CompanyName: 'Going', deletingAt: new Date(NOW) });
        const people = Array.from({ length: 150 }, (_, i) => mockDbFor('global').seed('users', { _id: id(), Employee_Email: `p${i}@acme.test`, lastSeenAt: new Date(NOW - i * DAY / 3) }));
        const supportUser = mockDbFor('global').seed('users', { _id: id(), Employee_Email: 'support@alianhub.com', isSupportUser: true, lastSeenAt: new Date(NOW) });
        people.forEach((person, i) => {
            const roleType = i >= 144 ? ROLE_GUEST : ROLE_MEMBER;
            mockDbFor(String(companies[i % 10]._id)).seed('company_users', { userId: String(person._id), userEmail: person.Employee_Email, status: SEAT_ACTIVE, roleType, isTrackerUser: i < 8, isDelete: false });
            if (i < 20) mockDbFor(String(companies[(i + 1) % 10]._id)).seed('company_users', { userId: String(person._id), userEmail: person.Employee_Email, status: SEAT_ACTIVE, roleType: ROLE_MEMBER, isDelete: false });
        });
        companies.forEach((company) => mockDbFor(String(company._id)).seed('company_users', { userId: String(supportUser._id), userEmail: 'support@alianhub.com', status: SEAT_ACTIVE, roleType: ROLE_ADMIN, isSupportUser: true, isDelete: false }));
        mockDbFor(String(companies[0]._id)).seed('company_users', { userEmail: 'invited@acme.test', status: SEAT_PENDING, isDelete: false });
        mockDbFor(String(companies[0]._id)).seed('company_users', { userEmail: 'withdrawn@acme.test', status: SEAT_CANCELLED, isDelete: false });
        mockDbFor('global').seed('storage_usage', { _id: String(companies[0]._id), bytes: 13000000000, objects: 10 });
        mockDbFor('global').seed('storage_usage', { _id: 'public', bytes: 312000000, objects: 3 });
        return { companies };
    };

    beforeAll(() => {
        platformState._useStoreForTests(platformState.memoryStore({ mail: { day: '2026-11-02', sent: 140 } }));
        Object.assign(instanceState, { migrationsPending: 0, migrationError: null });
    });
    afterAll(() => platformState._useStoreForTests(null));

    it('has every field of the contract for 150 people in 10 workspaces, in well under a second', async () => {
        const { companies } = world();
        const startedAt = Date.now();
        const report = await usage.buildUsage(NOW);
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(report).toMatchObject({
            at: new Date(NOW),
            version: expect.any(String),
            seats: { active: 150, pending: 1, guests: 6, limit: 10 },
            workspaces: { count: 10, limit: 1 },
            storage: { bytes: 13312000000, limit: 20 * 1024 ** 3, byWorkspace: [{ companyId: String(companies[0]._id), name: 'Workspace 0', bytes: 13000000000 }] },
            timeTracker: { seatsUsed: 8, limit: 0 },
            mail: { sentToday: 140, limit: 500 },
            activity: { lastActiveAt: new Date(NOW), dau: 3, mau: 91 },
            migrations: { pending: 0, error: null },
        });
    });

    it('reports nothing sent on a day the counter has not reached', async () => {
        const report = await usage.buildUsage(NOW + DAY);
        expect(report.mail.sentToday).toBe(0);
    });

    it('answers from its cache for a minute', async () => {
        usage._resetForTests();
        const first = await usage.usageReport(NOW);
        mockDbFor('global').seed('companies', { _id: id(), Cst_CompanyName: 'New' });
        expect(await usage.usageReport(NOW + usage.CACHE_MS - 1)).toBe(first);
        expect((await usage.usageReport(NOW + usage.CACHE_MS)).workspaces.count).toBe(11);
    });
});
