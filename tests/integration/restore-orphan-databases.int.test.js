const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });

const databaseNames = async () => (await client.db('admin').admin().listDatabases({ nameOnly: true })).databases.map((db) => db.name);

beforeAll(() => client.connect());
afterAll(() => client.close());

describe('restoring a backup taken before a company existed', () => {
    it('reports the later company database as orphaned and drops it only on the explicit action', async () => {
        const { api } = await loginAs('owner');
        const created = await api.post('/api/v2/instance/backups', {});
        expect(created.status).toBe(200);
        const { name } = created.body.data;

        const later = new ObjectId();
        const laterId = String(later);
        await client.db('global').collection('companies').insertOne({ _id: later, Cst_CompanyName: 'Created after the backup' });
        await client.db(laterId).collection('projects').insertOne({ ProjectName: 'Keep me until asked' });

        try {
            const restored = await api.post(`/api/v2/instance/backups/${name}/restore`, { confirm: name });
            expect(restored.status).toBe(200);
            const orphans = restored.body.data.orphanedDatabases;
            // Other suites share this Mongo and can leave company databases of their own behind.
            expect(orphans).toContainEqual({ name: laterId, sizeOnDisk: expect.any(Number) });
            expect(orphans.map((db) => db.name)).not.toContain(state.companyId);

            expect(await client.db('global').collection('companies').findOne({ _id: later })).toBeNull();
            expect(await databaseNames()).toContain(laterId);
            expect(await client.db(laterId).collection('projects').countDocuments()).toBe(1);

            const listed = await api.get('/api/v2/instance/orphan-databases');
            expect(listed.status).toBe(200);
            expect(listed.body.data.databases.map((db) => db.name)).toContain(laterId);
            expect(listed.body.data.databases.map((db) => db.name)).not.toContain(state.companyId);

            const unconfirmed = await api.post(`/api/v2/instance/orphan-databases/${laterId}/drop`, { confirm: 'yes' });
            expect(unconfirmed.status).toBe(400);
            expect(await databaseNames()).toContain(laterId);

            const referenced = await api.post(`/api/v2/instance/orphan-databases/${state.companyId}/drop`, { confirm: state.companyId });
            expect(referenced.status).toBe(409);
            expect(await databaseNames()).toContain(state.companyId);

            const dropped = await api.post(`/api/v2/instance/orphan-databases/${laterId}/drop`, { confirm: laterId });
            expect(dropped.status).toBe(200);
            expect(dropped.body.data).toMatchObject({ name: laterId });
            expect(await databaseNames()).not.toContain(laterId);
            expect((await api.get('/api/v2/instance/orphan-databases')).body.data.databases.map((db) => db.name)).not.toContain(laterId);
        } finally {
            await api.delete(`/api/v2/instance/backups/${name}`);
            await client.db(laterId).dropDatabase();
        }
    }, 120000);
});
