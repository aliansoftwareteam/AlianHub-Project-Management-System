process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const F_OPEN = '6f0000000000000000000e01';
const F_PRIVATE = '6f0000000000000000000e02';

/* What each person can open of the places a task row may be joined to. */
const OPEN = {
    projects: { [OWNER]: [P_OPEN, P_PRIVATE], [ADMIN]: [P_OPEN, P_PRIVATE], [INSIDER]: [P_OPEN, P_PRIVATE, P_PERSONAL], [OUTSIDER]: [P_OPEN], [GUEST]: [P_OPEN] },
    sprints: { [OWNER]: [L_OPEN, L_SECRET, L_PRIVATE], [ADMIN]: [L_OPEN, L_SECRET, L_PRIVATE], [INSIDER]: [L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL], [OUTSIDER]: [L_OPEN], [GUEST]: [L_OPEN] },
    folders: { [OWNER]: [F_OPEN, F_PRIVATE], [ADMIN]: [F_OPEN, F_PRIVATE], [INSIDER]: [F_OPEN, F_PRIVATE], [OUTSIDER]: [F_OPEN], [GUEST]: [F_OPEN] },
};
const JOIN_FIELD = { projects: 'ProjectID', sprints: 'sprintId', folders: 'folderObjId' };
const ALL = { projects: [P_OPEN, P_PRIVATE, P_PERSONAL], sprints: [L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL], folders: [F_OPEN, F_PRIVATE] };

const found = async (uid, findQuery) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    await getTaskByQyery(verified({ uid, headers: { companyid: CID }, params: {}, query: {}, body: { findQuery } }), res);
    return res;
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_OPEN, name: 'Open folder', projectId: P_OPEN });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_PRIVATE, name: 'Folder of the private project', projectId: P_PRIVATE });
});

describe('a row joined to a task in a task query', () => {
    const cases = Object.keys(JOIN_FIELD).flatMap((from) => EVERYONE.map(([who, uid]) => [from, who, uid]));

    it.each(cases)('from %s is given to %s only when they can open it, whatever id the query puts in the joined field', async (from, who, uid) => {
        const joined = [];
        for (const id of ALL[from]) {
            const { body } = await found(uid, [
                { $limit: 1 },
                { $addFields: { objId: { [JOIN_FIELD[from]]: id } } },
                { $lookup: { from, localField: JOIN_FIELD[from], foreignField: '_id', as: 'joined' } },
            ]);
            joined.push(...body.flatMap((row) => row.joined.map((entry) => String(entry._id))));
        }
        expect(joined.sort()).toEqual([...OPEN[from][uid]].sort());
    });

    it.each(EVERYONE)('still carries, for %s, the project and the list of each task they read', async (who, uid) => {
        const { body } = await found(uid, [
            { $match: { deletedStatusKey: 0 } },
            { $lookup: { from: 'projects', localField: 'ProjectID', foreignField: '_id', as: 'project', pipeline: [{ $project: { ProjectName: 1 } }] } },
            { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'list', pipeline: [{ $project: { name: 1 } }] } },
        ]);
        expect(body.length).toBeGreaterThan(0);
        expect(body.every((row) => row.project.length === 1 && row.list.length === 1)).toBe(true);
        expect(body.map((row) => String(row.list[0]._id)).sort()).toEqual([...OPEN.sprints[uid]].sort());
    });
});
