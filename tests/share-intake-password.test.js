const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/PublicShares/helpers/shareAccess', () => ({
    canManageShare: async () => ({ ok: true, statusCode: 200 }),
    shareStillAuthorised: async () => true,
}));

const bcrypt = require('bcrypt');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { hashPassword } = require('../Modules/Auth/helpers/passwordHash');
const renderer = require('../Modules/PublicShares/publicRenderer');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const SPRINT = '6f00000000000000000000b1';
const TOKEN = 'cd'.repeat(32);
const PASSWORD = 'the share password';
const WRONG = 'not the share password';
const REQUEST = { title: 'Add dark mode', description: 'Please', name: 'Visitor', email: 'visitor@example.test' };

const STORED_FORMATS = [
    ['stored before the format version', async (password) => ({ passwordHash: await bcrypt.hash(password, 4) })],
    ['stored in the current format', (password) => hashPassword(password)],
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Launch sprint', deletedStatusKey: 0 });
});

const seedShare = (over) => {
    const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, {
        entityType: 'sprint', entityId: SPRINT, token: TOKEN, enabled: true, allowIntake: true, createdBy: OWNER, ...over,
    });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: TOKEN, companyId: COMPANY, shareId: share._id });
    return share;
};
const intakeItems = () => mockDb.store[SCHEMA_TYPE.INTAKE_ITEMS] || [];

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    return res;
};
const answer = async (handler, req) => {
    const res = response();
    await handler({ params: { token: TOKEN }, query: {}, headers: {}, ...req }, res);
    return { status: res.statusCode, page: String(res.body).replace(/<style>[\s\S]*?<\/style>/, '') };
};
const submit = (fields) => answer(renderer.submitIntake, { method: 'POST', body: { ...REQUEST, ...fields } });
const view = (password) => answer(renderer.renderShare, password === undefined
    ? { method: 'GET', body: {} }
    : { method: 'POST', body: { password } });
const submitted = (reply) => reply.status === 200 && reply.page.includes('your request was submitted');
const requestForm = (page) => (/<form method="POST" action="\/share\/[0-9a-f]+\/intake">[\s\S]*?<\/form>/.exec(page) || [''])[0];

describe.each(STORED_FORMATS)('intake on a password-protected share, its password %s', (_label, stored) => {
    it('is refused without the password, or with a wrong one, as a wrong password on the view is', async () => {
        seedShare(await stored(PASSWORD));
        const wrongOnView = await view(WRONG);

        expect(wrongOnView.page).toContain('<h1>Password required</h1>');
        expect(await submit({})).toEqual(wrongOnView);
        expect(await submit({ password: '' })).toEqual(wrongOnView);
        expect(await submit({ password: WRONG })).toEqual(wrongOnView);
        expect(intakeItems()).toEqual([]);
    });

    it('is accepted with the password, which is not kept with the request', async () => {
        seedShare(await stored(PASSWORD));

        expect(submitted(await submit({ password: PASSWORD }))).toBe(true);
        expect(intakeItems()).toHaveLength(1);
        expect(intakeItems()[0]).toMatchObject({ ...REQUEST, status: 'pending' });
        expect(JSON.stringify(intakeItems()[0])).not.toContain(PASSWORD);
    });

    it('answers the same whether or not intake is on, until the password is given', async () => {
        seedShare({ ...(await stored(PASSWORD)), allowIntake: false });
        const wrongOnView = await view(WRONG);

        expect(await submit({})).toEqual(wrongOnView);
        expect(await submit({ password: WRONG })).toEqual(wrongOnView);
        expect((await submit({ password: PASSWORD })).status).toBe(404);
        expect(intakeItems()).toEqual([]);
    });
});

describe('the board of a password-protected share', () => {
    it('offers a request form that asks for the password', async () => {
        seedShare({ passwordHash: await bcrypt.hash(PASSWORD, 4) });

        const form = requestForm((await view(PASSWORD)).page);
        expect(form).toContain('name="title"');
        expect(form).toMatch(/<input name="password" type="password" required>/);
    });
});

describe('intake on a share without a password', () => {
    it('is accepted without one, as before', async () => {
        seedShare({});

        expect(submitted(await submit({}))).toBe(true);
        expect(intakeItems()).toHaveLength(1);
        expect(requestForm((await view()).page)).not.toContain('name="password"');
    });

    it('is still not found when intake is off', async () => {
        seedShare({ allowIntake: false });

        const reply = await submit({});
        expect(reply.status).toBe(404);
        expect(reply.page).toContain('This link is not available.');
        expect(intakeItems()).toEqual([]);
    });
});
