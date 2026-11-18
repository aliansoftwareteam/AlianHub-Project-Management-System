const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/service', () => ({ SendEmail: jest.fn() }));
jest.mock('../Modules/projectClose/helper', () => ({
    VALID_INACTIVE_MONTHS: [3, 6, 12],
    getCompanyPolicy: jest.fn(async () => ({ enabled: false })),
    updateCompanyPolicy: jest.fn(async (_companyId, patch) => patch),
}));
jest.mock('../Modules/TimeSheet/helpers/reminderSettings', () => ({
    getCompanySettings: jest.fn(async () => ({ enabled: false })),
    updateCompanySettings: jest.fn(async (_companyId, patch) => patch),
}));
jest.mock('../Modules/ScreenshotRetention/helper', () => ({
    VALID_MAX_AGE_MONTHS: [3, 6, 12],
    getCompanyPolicy: jest.fn(async () => ({ enabled: false })),
    updateCompanyPolicy: jest.fn(async (_companyId, patch) => patch),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const projectClose = require('../Modules/projectClose/controller');
const projectCloseHelper = require('../Modules/projectClose/helper');
const timeReminders = require('../Modules/TimeSheet/controller/timeReminders');
const reminderSettings = require('../Modules/TimeSheet/helpers/reminderSettings');
const screenshots = require('../Modules/ScreenshotRetention/controller');
const screenshotHelper = require('../Modules/ScreenshotRetention/helper');

const C = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000a01';

const call = async (handler, body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ headers: { companyid: C }, uid: CALLER, aud: C, body, params: {}, query: {} }, res);
    return res;
};

const seedSeat = (roleType, seat = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: CALLER, roleType, status: 2, isDelete: false, ...seat });

const SETTINGS = [
    ['the auto-close settings', projectClose.updateSettings, projectCloseHelper.updateCompanyPolicy],
    ['the time reminder settings', timeReminders.updateReminderSettings, reminderSettings.updateCompanySettings],
    ['the screenshot retention settings', screenshots.updateSettings, screenshotHelper.updateCompanyPolicy],
];

const NOT_ACTIVE = [
    ['a removed owner', 1, { isDelete: true }],
    ['a removed admin', 2, { isDelete: true }],
    ['an owner invitation not yet accepted', 1, { status: 1 }],
    ['a cancelled admin invitation', 2, { status: 3 }],
];

beforeEach(() => {
    mockDb = fakeMongo.create();
    jest.clearAllMocks();
});

describe.each(SETTINGS)('changing %s', (_what, handler, write) => {
    it.each(NOT_ACTIVE)('is refused for %s', async (_who, roleType, seat) => {
        seedSeat(roleType, seat);
        const res = await call(handler, { enabled: false });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false });
        expect(write).not.toHaveBeenCalled();
    });

    it.each([[1, 'an owner'], [2, 'an admin']])('is still allowed for role %s (%s) with an active seat', async (roleType) => {
        seedSeat(roleType);
        const res = await call(handler, { enabled: false });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('is still refused for a member', async () => {
        seedSeat(3);
        expect((await call(handler, { enabled: false })).statusCode).toBe(403);
        expect(write).not.toHaveBeenCalled();
    });
});
