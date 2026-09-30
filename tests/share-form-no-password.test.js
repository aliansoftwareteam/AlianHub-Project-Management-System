const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/PublicShares/helpers/shareAccess', () => ({
    canManageShare: async () => ({ ok: true, statusCode: 200 }),
    shareStillAuthorised: async () => true,
    shareIsLive: async (companyId, share) => Boolean(share) && share.enabled !== false,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const shares = require('../Modules/PublicShares/controller');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const FORM = '6f00000000000000000000f1';
const SPRINT = '6f00000000000000000000b1';
const FORM_SHARE = '6f00000000000000000005f1';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const manage = async (handler, { params = {}, body = {} }) => {
    const res = response();
    await handler({ uid: OWNER, params, body, query: {}, headers: { companyid: COMPANY } }, res);
    return res;
};
const storedShares = () => mockDb.store[SCHEMA_TYPE.PUBLIC_SHARES] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.FORMS, { _id: FORM, ProjectID: '6f00000000000000000000a1', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Launch sprint', deletedStatusKey: 0 });
});

/* The public form page never asks for a share password, so accepting one on a form link
 * would promise protection that does not exist. Forms stay public by design (owner, 2026-09-27). */
describe('a public form link cannot be given a password', () => {
    it('refuses to create a form link with a password, and stores nothing', async () => {
        const res = await manage(shares.createShare, { body: { entityType: 'form', entityId: FORM, password: 'secret words' } });
        expect(res.body.status).toBe(false);
        expect(storedShares()).toHaveLength(0);
    });

    it('refuses to set a password on an existing form link, and leaves it as it was', async () => {
        mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { _id: FORM_SHARE, entityType: 'form', entityId: FORM, token: 'ab'.repeat(32), enabled: true });
        const res = await manage(shares.updateShare, { params: { id: FORM_SHARE }, body: { password: 'secret words' } });
        expect(res.body.status).toBe(false);
        expect(storedShares()[0].passwordHash).toBeUndefined();
    });

    it('still lets a form link have an old password cleared', async () => {
        mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { _id: FORM_SHARE, entityType: 'form', entityId: FORM, token: 'ab'.repeat(32), enabled: true, passwordHash: 'x' });
        const res = await manage(shares.updateShare, { params: { id: FORM_SHARE }, body: { password: '' } });
        expect(res.body.status).toBe(true);
        expect(storedShares()[0].passwordHash).toBeNull();
    });

    it('keeps passwords on other links', async () => {
        const res = await manage(shares.createShare, { body: { entityType: 'sprint', entityId: SPRINT, password: 'secret words' } });
        expect(res.body.status).toBe(true);
        expect(typeof storedShares()[0].passwordHash).toBe('string');
    });
});
