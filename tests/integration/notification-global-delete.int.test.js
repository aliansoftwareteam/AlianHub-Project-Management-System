const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { newId, tag } = require('./notificationSeed');

const state = readState();
const MARKER = `global-delete-${tag()}`;

let client;
let member;
let owner;

const globalRows = () => client.db('global').collection('notifications');

const seed = async ({ receiverID, companyId = state.companyId }) => {
    const notificationId = newId();
    await globalRows().insertOne({ notificationId, receiverID, companyId, message: MARKER, notificationType: 'push' });
    return notificationId;
};

const exists = async (notificationId) => Boolean(await globalRows().findOne({ notificationId }));
const shape = (res) => ({ status: res.status, body: res.body });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    member = await loginAs('member');
    owner = await loginAs('owner');
});

afterAll(async () => {
    if (!client) return;
    await globalRows().deleteMany({ message: MARKER });
    await client.close();
});

describe('DELETE /api/v1/app-notification/mark-read/:key/:id removes only the caller\'s own notification', () => {
    it('leaves someone else\'s notification in place and answers as for one that does not exist', async () => {
        const theirs = await seed({ receiverID: owner.userId });

        const notYours = await member.api.delete(`/api/v1/app-notification/mark-read/notifications/${theirs}`);
        const missing = await member.api.delete(`/api/v1/app-notification/mark-read/notifications/${newId()}`);

        expect(await exists(theirs)).toBe(true);
        expect(notYours.status).toBe(404);
        expect(shape(notYours)).toEqual(shape(missing));
    });

    it('leaves the caller\'s notification from another company in place', async () => {
        const elsewhere = await seed({ receiverID: member.userId, companyId: newId() });

        const res = await member.api.delete(`/api/v1/app-notification/mark-read/notifications/${elsewhere}`);

        expect(res.status).toBe(404);
        expect(await exists(elsewhere)).toBe(true);
    });

    it('removes the caller\'s own notification', async () => {
        const mine = await seed({ receiverID: member.userId });

        const res = await member.api.delete(`/api/v1/app-notification/mark-read/notifications/${mine}`);

        expect([res.status, res.body && res.body.status]).toEqual([200, true]);
        expect(await exists(mine)).toBe(false);
    });
});
