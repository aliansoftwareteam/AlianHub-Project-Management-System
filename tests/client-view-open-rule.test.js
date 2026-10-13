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

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { getClientView, buildClientPayload } = require('../Modules/Milestone/controller/clientView');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, T_SECRET, OPENS } = world;
const { seed, setRule } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];

/* The client contact is on both tasks of the project, one of them in a private list. */
beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, { ProjectID: P_OPEN, clientName: 'Client', clientContactIds: [INSIDER], currency: 'USD', deletedStatusKey: 0, updatedBy: OWNER });
});

const waiting = (view) => view.waitingOnYou.map((item) => item.title).sort();

describe('what a client view says is waiting on the client', () => {
    it.each(EVERYONE)('names for %s the tasks they can open', async (who, uid) => {
        const res = { body: null };
        res.status = () => res;
        res.json = (answer) => { res.body = answer; return res; };
        res.send = res.json;
        await getClientView(verified({ uid, headers: { companyid: CID }, query: { projectId: P_OPEN }, params: {}, body: {} }), res);

        expect(waiting(res.body.data)).toEqual(OPENS[uid].includes(T_SECRET) ? ['Open task', 'Secret task'] : ['Open task']);
    });

    it('names them for a client whose role does not list tasks, since the view is the project\'s own', async () => {
        setRule('task_list', null);
        expect(waiting(await buildClientPayload(CID, P_OPEN, GUEST))).toEqual(['Open task']);
        expect(waiting(await buildClientPayload(CID, P_OPEN, INSIDER))).toEqual(['Open task', 'Secret task']);
    });

    it('names on a public link no task of a private list', async () => {
        expect(waiting(await buildClientPayload(CID, P_OPEN))).toEqual(['Open task']);
    });
});
