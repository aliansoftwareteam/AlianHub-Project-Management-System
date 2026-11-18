const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { SEAT_CANCELLED, newId, seedUser } = require('./notificationSeed');

const state = readState();
const COMPANY_B = newId();

let client;
let member;
let insider;
let former;
let outsider;

const push = (session, overrides = {}) => session.api.post('/api/v1/send-fcm', {
    message: 'hello',
    companyId: session.companyId,
    userIdArray: [insider],
    key: 'message_create',
    type: 'chat',
    senderUserDetail: { id: session.userId, Employee_Name: 'Max Member' },
    actionUrl: `${session.companyId}/chat/p/t`,
    ...overrides,
});

const shape = (res) => ({ status: res.status, body: res.body });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    member = await loginAs('member');
    insider = await seedUser(client, { name: 'Ivy Insider', seatIn: state.companyId, settingsIn: [state.companyId] });
    former = await seedUser(client, { name: 'Fay Former', seatIn: state.companyId, seatStatus: SEAT_CANCELLED, settingsIn: [state.companyId] });
    outsider = await seedUser(client, { name: 'Otto Outsider', seatIn: COMPANY_B, settingsIn: [COMPANY_B] });
});

afterAll(async () => {
    if (!client) return;
    const ids = [insider, former, outsider].filter(Boolean);
    await client.db(state.companyId).collection('company_users').deleteMany({ userId: { $in: ids } });
    await client.db(state.companyId).collection('notifications_settings').deleteMany({ userId: { $in: ids } });
    await client.db('global').collection('sessions').deleteMany({ userId: { $in: ids } });
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('POST /api/v1/send-fcm pushes within the verified company', () => {
    it('refuses a body that names another company', async () => {
        const res = await push(member, { companyId: COMPANY_B, userIdArray: [outsider] });
        expect([res.status, res.body && res.body.success]).toEqual([403, false]);
    });

    it('answers the same whether the recipients are members, former members or unknown', async () => {
        const answers = [
            shape(await push(member, { userIdArray: [insider] })),
            shape(await push(member, { userIdArray: [former] })),
            shape(await push(member, { userIdArray: [outsider] })),
            shape(await push(member, { userIdArray: [newId()] })),
        ];
        expect(answers[0].status).toBe(200);
        expect(answers.slice(1)).toEqual([answers[0], answers[0], answers[0]]);
    });

    it('still rejects a malformed request', async () => {
        const res = await push(member, { userIdArray: [] });
        expect(res.status).toBe(400);
    });
});
