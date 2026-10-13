const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const settings = require('../Modules/TimeSheet/helpers/reminderSettings');

const COMPANY_A = '64b7f0c2a1b2c3d4e5f60a01';
const COMPANY_B = '64b7f0c2a1b2c3d4e5f60b02';

const companies = () => mockDb.store[SCHEMA_TYPE.COMPANIES];
const companyDoc = (id) => companies().find((c) => String(c._id) === id);
let calls;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    calls = mockDb.calls;
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY_A, timeReminderSettings: { enabled: true, userIds: ['u1', 'u2'] } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY_B, timeReminderSettings: { enabled: false, userIds: ['b1'] } });
});

describe('normaliseSettings', () => {
    it('turns a missing policy into: off, nobody, no audit stamp', () => {
        expect(settings.normaliseSettings(undefined)).toEqual({ enabled: false, userIds: [], enabledAt: null, enabledBy: null });
        expect(settings.normaliseSettings(null)).toEqual({ enabled: false, userIds: [], enabledAt: null, enabledBy: null });
        expect(settings.normaliseSettings('on')).toEqual({ enabled: false, userIds: [], enabledAt: null, enabledBy: null });
    });

    it('is on only for a real true, not for truthy values', () => {
        expect(settings.normaliseSettings({ enabled: true }).enabled).toBe(true);
        expect(settings.normaliseSettings({ enabled: 'true' }).enabled).toBe(false);
        expect(settings.normaliseSettings({ enabled: 1 }).enabled).toBe(false);
    });

    it('lists each member once as text and drops blanks', () => {
        const out = settings.normaliseSettings({ userIds: ['a', 'a', 7, 7, '', 'b'] });
        expect(out.userIds).toEqual(['a', '7', 'b']);
    });

    it('drops a null member instead of keeping the text "null" as a recipient', () => {
        expect(settings.normaliseSettings({ userIds: ['a', null, undefined] }).userIds).toEqual(['a']);
    });

    it('treats a non-list userIds as nobody', () => {
        expect(settings.normaliseSettings({ userIds: 'a' }).userIds).toEqual([]);
    });
});

describe('getCompanySettings', () => {
    it('reads the policy of the company asked for', async () => {
        const a = await settings.getCompanySettings(COMPANY_A);
        expect(a.enabled).toBe(true);
        expect(a.userIds).toEqual(['u1', 'u2']);
        const b = await settings.getCompanySettings(COMPANY_B);
        expect(b.enabled).toBe(false);
        expect(b.userIds).toEqual(['b1']);
    });

    it('asks only for that company master document', async () => {
        await settings.getCompanySettings(COMPANY_A);
        expect(calls).toHaveLength(1);
        expect(calls[0].companyId).toBe(SCHEMA_TYPE.GOLBAL);
        expect(calls[0].type).toBe(SCHEMA_TYPE.COMPANIES);
        expect(String(calls[0].data[0]._id)).toBe(COMPANY_A);
    });

    it('reads a Map-shaped policy', async () => {
        companyDoc(COMPANY_A).timeReminderSettings = new Map([['enabled', true], ['userIds', ['m1']]]);
        const out = await settings.getCompanySettings(COMPANY_A);
        expect(out.enabled).toBe(true);
        expect(out.userIds).toEqual(['m1']);
    });

    it('returns the off default for a company with no saved policy or no document', async () => {
        delete companyDoc(COMPANY_A).timeReminderSettings;
        expect((await settings.getCompanySettings(COMPANY_A)).enabled).toBe(false);
        expect(await settings.getCompanySettings('64b7f0c2a1b2c3d4e5f60c03')).toEqual({ enabled: false, userIds: [], enabledAt: null, enabledBy: null });
    });
});

describe('updateCompanySettings', () => {
    it('changes only the company named and leaves the other policy alone', async () => {
        await settings.updateCompanySettings(COMPANY_B, { enabled: true, userIds: ['b1', 'b2'] });
        expect(companyDoc(COMPANY_B).timeReminderSettings.enabled).toBe(true);
        expect(companyDoc(COMPANY_A).timeReminderSettings.userIds).toEqual(['u1', 'u2']);
        const write = calls.find((c) => c.method === 'findOneAndUpdate');
        expect(String(write.data[0]._id)).toBe(COMPANY_B);
    });

    it('returns the saved policy', async () => {
        const out = await settings.updateCompanySettings(COMPANY_A, { userIds: ['u9', 'u9', 'u8'] });
        expect(out.userIds).toEqual(['u9', 'u8']);
        expect(out.enabled).toBe(true);
    });

    it('ignores a non-boolean enabled', async () => {
        await settings.updateCompanySettings(COMPANY_A, { enabled: 'no' });
        expect(calls.some((c) => c.method === 'findOneAndUpdate')).toBe(false);
        expect(companyDoc(COMPANY_A).timeReminderSettings.enabled).toBe(true);
    });

    it('clears the recipients when userIds is not a list', async () => {
        const out = await settings.updateCompanySettings(COMPANY_A, { userIds: 'u1' });
        expect(out.userIds).toEqual([]);
    });

    it('stamps who switched it on and when', async () => {
        const out = await settings.updateCompanySettings(COMPANY_B, { enabled: true }, { markEnabled: true, userId: 'owner1' });
        expect(out.enabledBy).toBe('owner1');
        expect(out.enabledAt).toBeInstanceOf(Date);
    });

    it('does not stamp without a user', async () => {
        const out = await settings.updateCompanySettings(COMPANY_B, { enabled: true }, { markEnabled: true });
        expect(out.enabledBy).toBeNull();
    });

    it('rejects an invalid company id instead of writing', async () => {
        await expect(settings.updateCompanySettings('nope', { enabled: true })).rejects.toThrow();
        expect(calls).toHaveLength(0);
    });
});
