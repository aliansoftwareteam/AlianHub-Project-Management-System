jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const inboxes = require('../Modules/EmailIn/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL } = world;
const { seed, rows } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const OPEN_PROJECTS = { [OWNER]: [P_OPEN, P_PRIVATE], [ADMIN]: [P_OPEN, P_PRIVATE], [INSIDER]: [P_OPEN, P_PRIVATE, P_PERSONAL], [OUTSIDER]: [P_OPEN], [GUEST]: [P_OPEN] };
const OPEN_LISTS = { [OWNER]: [L_OPEN, L_SECRET, L_PRIVATE], [ADMIN]: [L_OPEN, L_SECRET, L_PRIVATE], [INSIDER]: [L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL], [OUTSIDER]: [L_OPEN], [GUEST]: [L_OPEN] };
const PLACES = [[P_OPEN, L_OPEN], [P_OPEN, L_SECRET], [P_PRIVATE, L_PRIVATE], [P_PERSONAL, L_PERSONAL]];
const MISSING = '6f0000000000000000000fff';

const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handler(verified({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ...req }), res);
    return res.body;
};
const kept = () => rows(SCHEMA_TYPE.EMAIL_INBOXES);
const inboxOf = (listId) => kept().find((row) => String(row.sprintId) === listId);

const seedRows = () => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent);
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    PLACES.forEach(([ProjectID, sprintId]) => mockDb.seed(SCHEMA_TYPE.EMAIL_INBOXES, {
        token: `token-${sprintId}`, companyId: CID, name: `Inbox of ${sprintId}`, ProjectID, sprintId, sprintArray: { id: sprintId, name: 'List' }, enabled: true, createdBy: INSIDER, deletedStatusKey: 0,
    }));
};

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('an email inbox that turns mail into tasks', () => {
    it.each(EVERYONE)('is made by %s only in a project and a list they can open', async (who, uid) => {
        const missing = await answered(inboxes.createInbox, { uid, body: { projectId: MISSING } });
        for (const [projectId, sprintId] of PLACES) {
            const before = kept().length;
            const answer = await answered(inboxes.createInbox, { uid, body: { projectId, sprintId, sprintArray: { id: sprintId, name: 'List' } } });
            const opens = OPEN_PROJECTS[uid].includes(projectId) && OPEN_LISTS[uid].includes(sprintId);

            expect([sprintId, answer.status]).toEqual([sprintId, opens]);
            expect(kept().length).toBe(before + (opens ? 1 : 0));
            if (!opens) expect(answer).toEqual(missing);
        }
    });

    it.each(EVERYONE)('picks for %s, when no list is named, a list they can open', async (who, uid) => {
        rows(SCHEMA_TYPE.SPRINTS).find((list) => String(list._id) === L_OPEN).deletedStatusKey = 1;
        const answer = await answered(inboxes.createInbox, { uid, body: { projectId: P_OPEN } });
        expect(answer.status).toBe(OPEN_LISTS[uid].includes(L_SECRET));
        if (answer.status) expect(String(answer.data.sprintId)).toBe(L_SECRET);
    });

    it.each(EVERYONE)('is listed for %s only when they can open its project and its list', async (who, uid) => {
        const { data } = await answered(inboxes.listInboxes, { uid });
        expect(data.map((row) => String(row.sprintId)).sort()).toEqual([...OPEN_LISTS[uid]].sort());
        const named = await answered(inboxes.listInboxes, { uid, query: { projectId: P_PRIVATE } });
        expect(named.data.map((row) => String(row.sprintId))).toEqual(OPEN_LISTS[uid].includes(L_PRIVATE) ? [L_PRIVATE] : []);
    });

    it.each(EVERYONE)('is switched off or removed by %s only when they can open its project and its list', async (who, uid) => {
        for (const [, sprintId] of PLACES) {
            const id = String(inboxOf(sprintId)._id);
            const opens = OPEN_LISTS[uid].includes(sprintId);

            expect([sprintId, (await answered(inboxes.updateInbox, { uid, params: { id }, body: { enabled: false } })).status]).toEqual([sprintId, opens]);
            expect(inboxOf(sprintId).enabled).toBe(!opens);
            expect([sprintId, (await answered(inboxes.deleteInbox, { uid, params: { id } })).status]).toEqual([sprintId, opens]);
            expect(inboxOf(sprintId).deletedStatusKey).toBe(opens ? 1 : 0);
        }
    });
});
