const { MongoClient, ObjectId } = require('mongodb');
const { readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

const state = readState();
const DOWNLOAD_FIELDS = ['_id', 'title', 'type', 'version', 'downloadUrl', 'description'];

let client;
let title;

const anonymousGet = async (query) => {
    const res = await fetch(new URL(`/api/v1/tracker?${new URLSearchParams(query)}`, state.baseURL), { headers: { accept: 'application/json' } });
    return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    title = `Tracker ${uniqueSuffix()}`;
    await client.db('global').collection('timeTrackerDownload').insertOne({
        title,
        type: 'Mac',
        version: '9.9.9',
        downloadUrl: 'https://downloads.e2e.alianhub.test/tracker.dmg',
        description: 'Desktop tracker',
        userId: new ObjectId(state.users.owner.userId),
        createdAt: new Date(),
    });
});

afterAll(async () => {
    if (client) {
        await client.db('global').collection('timeTrackerDownload').deleteMany({ title });
        await client.close();
    }
});

describe('the tracker downloads anyone can read', () => {
    it.each([[{ currentPage: 1, search: '', sort: '{}' }], [{ currentPage: 1, search: '', sort: JSON.stringify({ createdAt: 1 }), source: 'front' }]])('list only download fields for %j', async (query) => {
        const res = await anonymousGet(query);
        expect(res.status).toBe(200);
        const row = res.body.data.find((item) => item.title === title);
        expect(row).toBeDefined();
        expect(row.downloadUrl).toBe('https://downloads.e2e.alianhub.test/tracker.dmg');
        for (const item of res.body.data) {
            expect(Object.keys(item).filter((key) => !DOWNLOAD_FIELDS.includes(key))).toEqual([]);
        }
        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('Olivia');
        expect(wire).not.toContain(state.users.owner.userId);
    });

    it('does not sort by a field it does not list', async () => {
        const res = await anonymousGet({ currentPage: 1, search: '', sort: JSON.stringify({ 'user_data.Employee_Name': 1 }) });
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('Olivia');
    });
});
