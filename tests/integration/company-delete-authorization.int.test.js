const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const FOREIGN_COMPANY = crypto.randomBytes(12).toString('hex');

let client;

/* The drop is irreversible, so "the database is still there" is the assertion that matters:
 * a refusal that still dropped would show up here and nowhere else. */
const databaseExists = async (name) => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    return databases.some((db) => db.name === name);
};

const deleteBody = (overrides = {}) => ({ companyId: state.companyId, confirm: state.companyName, ...overrides });

/* A company of its own to destroy, so the success case never touches the harness company
 * the rest of the integration suite runs against. */
const seedCompany = async (name, ownerUserId) => {
    const companyId = crypto.randomBytes(12).toString('hex');
    await client.db('global').collection('companies').insertOne({ _id: new ObjectId(companyId), Cst_CompanyName: name });
    await client.db(companyId).collection('company_users').insertOne({ userId: String(ownerUserId), roleType: 1, status: 2, isDelete: false });
    await client.db('global').collection('users').updateOne({ _id: new ObjectId(String(ownerUserId)) }, { $push: { AssignCompany: companyId } });
    return companyId;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (!client) return;
    await client.db(FOREIGN_COMPANY).dropDatabase();
    await client.close();
});

describe('POST /api/v2/company/delete', () => {
    it.each([['member'], ['admin'], ['guest']])('refuses %s, and the company database still exists', async (role) => {
        const session = await loginAs(role);
        const res = await session.api.post('/api/v2/company/delete', deleteBody());

        expect({ role, status: res.status, answered: res.body && res.body.status }).toEqual({ role, status: 403, answered: false });
        expect(await databaseExists(state.companyId)).toBe(true);
    });

    it('refuses the owner without the typed company name, and the company database still exists', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/company/delete', deleteBody({ confirm: 'not the name' }));

        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
        expect(await databaseExists(state.companyId)).toBe(true);
    });

    it('refuses a body company the caller is not in, and never creates its database', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/company/delete', deleteBody({ companyId: FOREIGN_COMPANY }));

        expect(res.status).toBe(403);
        expect(await databaseExists(FOREIGN_COMPANY)).toBe(false);
        expect(await databaseExists(state.companyId)).toBe(true);
    });

    it('refuses a body company id that is not a company id, and the global registry survives', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/company/delete', deleteBody({ companyId: 'global' }));

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(await databaseExists('global')).toBe(true);
    });

    /* The whole point of pinning: the role is read against the company the body names, not the
     * header, so owning some other company cannot buy the right to drop this one. */
    it('refuses a member who owns another company and aims the body at this one', async () => {
        const member = state.users.member;
        const ownedCompany = await seedCompany('Spoof Co', member.userId);
        const session = await loginAs('member');

        const res = await session.api.withCompany(ownedCompany).post('/api/v2/company/delete', deleteBody());

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(await databaseExists(state.companyId)).toBe(true);
        expect(await databaseExists(ownedCompany)).toBe(true);
    });

    it('lets the company owner delete their own company when the name is typed back', async () => {
        const owner = state.users.owner;
        const doomed = await seedCompany('Doomed Co', owner.userId);
        const session = await loginAs('owner');

        expect(await databaseExists(doomed)).toBe(true);

        const res = await session.api.withCompany(doomed).post('/api/v2/company/delete', { companyId: doomed, confirm: 'Doomed Co' });

        expect({ status: res.status, answered: res.body && res.body.status }).toEqual({ status: 200, answered: true });
        expect(await databaseExists(doomed)).toBe(false);
        expect(await client.db('global').collection('companies').countDocuments({ _id: new ObjectId(doomed) })).toBe(0);
        expect(await databaseExists(state.companyId)).toBe(true);
    });
});
