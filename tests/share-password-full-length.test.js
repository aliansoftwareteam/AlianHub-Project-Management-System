const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/PublicShares/helpers/shareAccess', () => ({
    canManageShare: async () => ({ ok: true, statusCode: 200 }),
    shareStillAuthorised: async () => true,
}));

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { publicSharesSchema } = require('../utils/mongo-handler/createSchema');
const shares = require('../Modules/PublicShares/controller');
const renderer = require('../Modules/PublicShares/publicRenderer');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const SPRINT = '6f00000000000000000000b1';
const TOKEN = 'ab'.repeat(32);
const OLD_PASSWORD = 'old share password';
const WRONG = 'wrong share password';
const SHARED_START = 'x'.repeat(80);
const CHOSEN = `${SHARED_START}-the-chosen-tail`;
const SAME_START = `${SHARED_START}-another-tail`;

/* Written out rather than imported, so a change to the stored format fails here instead of locking protected shares. */
const preHashed = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('base64');

const WRITE_METHODS = ['save', 'updateOne', 'updateMany', 'findOneAndUpdate'];
const shareWrites = () => mockDb.calls
    .filter((c) => c.type === SCHEMA_TYPE.PUBLIC_SHARES && WRITE_METHODS.includes(c.method))
    .map((c) => (c.method === 'save' ? c.data : (c.data[1].$set || c.data[1])));
const onlyShare = () => {
    const rows = mockDb.store[SCHEMA_TYPE.PUBLIC_SHARES] || [];
    expect(rows).toHaveLength(1);
    return rows[0];
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Launch sprint', deletedStatusKey: 0 });
});

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    return res;
};
const call = async (handler, req) => { const res = response(); await handler(req, res); return res; };
const manage = (handler, { params = {}, body = {} }) => call(handler, { uid: OWNER, params, body, query: {}, headers: { companyid: COMPANY } });
const open = async (token, password) => {
    const res = await call(renderer.renderShare, {
        params: { token }, query: {}, headers: {},
        method: password === undefined ? 'GET' : 'POST',
        body: password === undefined ? {} : { password },
    });
    return { status: res.statusCode, page: String(res.body).replace(/<style>[\s\S]*?<\/style>/, '') };
};
const opened = (answer) => answer.status === 200 && answer.page.includes('read-only public view');
const refused = (answer) => answer.status === 200 && answer.page.includes('<h1>Password required</h1>') && !answer.page.includes('read-only public view');

const waitFor = async (check) => {
    for (let i = 0; i < 300 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

const createWith = async (password) => {
    const res = await manage(shares.createShare, { body: { entityType: 'sprint', entityId: SPRINT, password } });
    expect(res.body.status).toBe(true);
    return res;
};
const changeTo = async (password) => {
    const created = await createWith(OLD_PASSWORD);
    const res = await manage(shares.updateShare, { params: { id: String(created.body.data._id) }, body: { password } });
    expect(res.body.status).toBe(true);
    return res;
};
const STORING_PATHS = [['creating the link', createWith], ['changing its password', changeTo]];

const seedLegacyShare = async (password) => {
    const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, {
        entityType: 'sprint', entityId: SPRINT, token: TOKEN, enabled: true, allowIntake: false, createdBy: OWNER,
        passwordHash: await bcrypt.hash(password, 4),
    });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: TOKEN, companyId: COMPANY, shareId: share._id });
    return share;
};

describe.each(STORING_PATHS)('a share password set by %s', (_label, store) => {
    it('opens the share only with every character of it', async () => {
        await store(CHOSEN);
        const { token } = onlyShare();

        const wrong = await open(token, WRONG);
        expect(refused(wrong)).toBe(true);
        expect(await open(token, SAME_START)).toEqual(wrong);
        expect(opened(await open(token, CHOSEN))).toBe(true);
    });

    it('is stored with its format version, which the owner is never sent', async () => {
        const res = await store(CHOSEN);

        const row = onlyShare();
        expect(row.passwordHashVersion).toBe(2);
        expect(await bcrypt.compare(preHashed(CHOSEN), row.passwordHash)).toBe(true);
        expect(res.body.data.hasPassword).toBe(true);
        expect(res.body.data).not.toHaveProperty('passwordHash');
        expect(res.body.data).not.toHaveProperty('passwordHashVersion');
    });
});

describe('removing a share password', () => {
    it('clears its format version with it, and the share opens without one', async () => {
        const created = await createWith(CHOSEN);
        const res = await manage(shares.updateShare, { params: { id: String(created.body.data._id) }, body: { password: '' } });

        expect(res.body.data.hasPassword).toBe(false);
        expect(onlyShare()).toMatchObject({ passwordHash: null, passwordHashVersion: null });
        expect(opened(await open(onlyShare().token))).toBe(true);
    });
});

describe('a share password stored before the format version', () => {
    it('still opens the share, and is stored in the current format after that', async () => {
        const legacyHash = (await seedLegacyShare(CHOSEN)).passwordHash;

        expect(opened(await open(TOKEN, CHOSEN))).toBe(true);
        await waitFor(() => onlyShare().passwordHashVersion === 2);

        const row = onlyShare();
        expect(row.passwordHashVersion).toBe(2);
        expect(row.passwordHash).not.toBe(legacyHash);
        expect(await bcrypt.compare(preHashed(CHOSEN), row.passwordHash)).toBe(true);
        expect(await open(TOKEN, SAME_START)).toEqual(await open(TOKEN, WRONG));
        expect(opened(await open(TOKEN, CHOSEN))).toBe(true);
    });

    it('writes nothing for a wrong password', async () => {
        const legacyHash = (await seedLegacyShare(OLD_PASSWORD)).passwordHash;

        expect(refused(await open(TOKEN, WRONG))).toBe(true);
        expect(refused(await open(TOKEN))).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(shareWrites()).toEqual([]);
        expect(onlyShare().passwordHash).toBe(legacyHash);

        expect(opened(await open(TOKEN, OLD_PASSWORD))).toBe(true);
        await waitFor(() => shareWrites().length > 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(shareWrites()).toHaveLength(1);
    });

    it('is not stored over a password the owner changed while it was being checked', async () => {
        await seedLegacyShare(OLD_PASSWORD);
        const changedMeanwhile = { passwordHash: await bcrypt.hash(preHashed('changed meanwhile'), 4), passwordHashVersion: 2 };
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.PUBLIC_SHARES && WRITE_METHODS.includes(method)) Object.assign(onlyShare(), changedMeanwhile);
            return crud(companyId, query, method);
        });
        try {
            expect(opened(await open(TOKEN, OLD_PASSWORD))).toBe(true);
            await waitFor(() => shareWrites().length > 0);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(onlyShare()).toMatchObject(changedMeanwhile);
    });
});

// fakeMongo keeps any field; the real publicShares schema is strict and drops undeclared ones on write.
describe('every field a share password is stored with survives the strict publicShares schema', () => {
    const undeclared = (fields) => Object.keys(fields).filter((key) => fields[key] !== undefined && !publicSharesSchema.path(key));

    it('declares the format version as a number', () => {
        expect(publicSharesSchema.path('passwordHashVersion') && publicSharesSchema.path('passwordHashVersion').instance).toBe('Number');
    });

    it.each([
        ...STORING_PATHS,
        ['removing the password', async () => {
            const created = await createWith(CHOSEN);
            await manage(shares.updateShare, { params: { id: String(created.body.data._id) }, body: { password: '' } });
        }],
        ['an open that upgrades an older hash', async () => {
            await seedLegacyShare(OLD_PASSWORD);
            await open(TOKEN, OLD_PASSWORD);
            await waitFor(() => shareWrites().length > 0);
        }],
    ])('%s', async (_label, store) => {
        await store(CHOSEN);

        expect(shareWrites().length).toBeGreaterThan(0);
        shareWrites().forEach((fields) => expect(undeclared(fields)).toEqual([]));
        expect(shareWrites().some((fields) => 'passwordHashVersion' in fields)).toBe(true);
    });
});
