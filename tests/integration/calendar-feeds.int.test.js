const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const migration = require('../../migrations/012-hash-calendar-feed-tokens');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const icsStatus = async (token) => (await anon.get(`/api/v1/calendar/ics/${token}`)).status;

/* The migration runs through MongoDbCrudOpration in the app; here the same find/updateOne
 * calls go straight to the database the test server is using. */
const migrationContext = (feeds) => ({
    SCHEMA_TYPE,
    logger: { info: () => {} },
    global: async ({ data }, method) => {
        if (method === 'find') return feeds.find(data[0], { projection: data[1] }).toArray();
        if (method === 'updateOne') return feeds.updateOne(data[0], data[1]);
        throw new Error(`unexpected ${method}`);
    },
});

describe('calendar feeds (PRJ-01)', () => {
    let client;
    let feeds;

    beforeAll(async () => {
        client = await MongoClient.connect(resolveMongoUrl());
        feeds = client.db(SCHEMA_TYPE.GOLBAL).collection(dbCollections.CALENDAR_FEEDS);
    });

    afterAll(async () => {
        await client.close();
    });

    it('stores only a hash of a new feed token and lists feeds without any token', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v1/calendar/feeds', { scope: 'my', name: `Feed ${uniqueSuffix()}` });
        const { _id, token } = created.body.data;
        try {
            const stored = await feeds.findOne({ _id: new ObjectId(String(_id)) });
            expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
            expect(stored.token).toBeUndefined();
            expect(JSON.stringify(stored)).not.toContain(token);

            const list = await owner.api.get('/api/v1/calendar/feeds');
            expect(list.body.data.map((f) => String(f._id))).toContain(String(_id));
            expect(JSON.stringify(list.body)).not.toContain(token);
            list.body.data.forEach((f) => ['token', 'tokenHash', 'url'].forEach((key) => expect(f[key]).toBeUndefined()));
        } finally {
            await owner.api.delete(`/api/v1/calendar/feeds/${_id}`);
        }
    });

    it('never lists, regenerates or deletes another user\'s feed', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const created = (await owner.api.post('/api/v1/calendar/feeds', { scope: 'my' })).body.data;
        try {
            const list = await member.api.get('/api/v1/calendar/feeds');
            expect(list.body.data.map((f) => String(f._id))).not.toContain(String(created._id));
            expect((await member.api.post(`/api/v1/calendar/feeds/${created._id}/regenerate`)).status).toBe(404);
            expect((await member.api.delete(`/api/v1/calendar/feeds/${created._id}`)).status).toBe(404);
            expect(await icsStatus(created.token)).toBe(200);
        } finally {
            await owner.api.delete(`/api/v1/calendar/feeds/${created._id}`);
        }
    });

    it('regenerating a link kills the old URL and the new one works', async () => {
        const owner = await loginAs('owner');
        const created = (await owner.api.post('/api/v1/calendar/feeds', { scope: 'my' })).body.data;
        try {
            expect(await icsStatus(created.token)).toBe(200);
            const regenerated = await owner.api.post(`/api/v1/calendar/feeds/${created._id}/regenerate`);
            expect(regenerated.status).toBe(200);
            expect(regenerated.body.data.token).not.toBe(created.token);
            expect(await icsStatus(created.token)).toBe(404);
            expect(await icsStatus(regenerated.body.data.token)).toBe(200);
        } finally {
            await owner.api.delete(`/api/v1/calendar/feeds/${created._id}`);
        }
    });

    it('a feed URL handed out before tokens were hashed keeps working after the migration', async () => {
        const owner = await loginAs('owner');
        const token = crypto.randomBytes(18).toString('hex');
        const now = new Date();
        const { insertedId } = await feeds.insertOne({
            token, companyId: state.companyId, userId: owner.uid, scope: 'my', projectId: '', name: 'Legacy feed',
            enabled: true, createdBy: owner.uid, deletedStatusKey: 0, createdAt: now, updatedAt: now,
        });
        try {
            expect(await icsStatus(token)).toBe(404);

            const first = await migration.up(migrationContext(feeds));
            expect(first.hashed).toBeGreaterThanOrEqual(1);
            const migrated = await feeds.findOne({ _id: insertedId });
            expect(migrated.token).toBeUndefined();
            expect(migrated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
            expect(await icsStatus(token)).toBe(200);

            expect(await migration.up(migrationContext(feeds))).toEqual({ hashed: 0 });
            expect(await icsStatus(token)).toBe(200);
        } finally {
            await feeds.deleteOne({ _id: insertedId });
        }
    });

    it('refuses a project feed on a private project the caller is not a member of', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/calendar/feeds', { scope: 'project', projectId: state.projects.restricted._id });
        expect(res.status).toBe(404);
        expect(res.body.status).toBe(false);
    });
});
