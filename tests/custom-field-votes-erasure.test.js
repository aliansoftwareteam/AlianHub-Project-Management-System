const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const controls = require('../Modules/Knowledge/controls');
const { eraseVoter } = require('../Modules/CustomField/helpers/fieldLinkStore');

/* A vote names the person who cast it. Erasure by person is the one path that forgets a person, so their votes go with
 * it and each task's count follows. */

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const VOTES = '6f0000000000000000000e32';
const MORE_VOTES = '6f0000000000000000000e33';
const CLIENT = '6f0000000000000000000e31';
const [FIRST, SECOND, THIRD] = [1, 2, 3].map((n) => `6f0000000000000000000b0${n}`);
const LINKS = SCHEMA_TYPE.CUSTOM_FIELD_LINKS;

const votesOf = (companyId, taskId, fieldId = VOTES) => (mockDbFor(companyId).store[LINKS] || []).find((row) => row.taskId === taskId && row.fieldId === fieldId);
const tallyOf = (companyId, taskId, fieldId = VOTES) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS].find((row) => row._id === taskId).customField[fieldId];

const seed = (companyId) => {
    const db = mockDbFor(companyId);
    const voted = (taskId, fieldId, ids, version) => {
        db.seed(LINKS, { taskId, fieldId, kind: 'voting', ids, version });
        return { [fieldId]: { _id: fieldId, fieldValue: ids.length, revision: 5, version } };
    };
    db.seed(SCHEMA_TYPE.TASKS, { _id: FIRST, TaskName: 'First', customField: { ...voted(FIRST, VOTES, [ALICE, BOB], 2), ...voted(FIRST, MORE_VOTES, [ALICE], 1) } });
    db.seed(SCHEMA_TYPE.TASKS, { _id: SECOND, TaskName: 'Second', customField: voted(SECOND, VOTES, [BOB], 1) });
    db.seed(SCHEMA_TYPE.TASKS, { _id: THIRD, TaskName: 'Third', customField: { [CLIENT]: { _id: CLIENT, fieldValue: '', revision: 5 } } });
    db.seed(LINKS, { taskId: THIRD, fieldId: CLIENT, kind: 'relationship', ids: [ALICE, FIRST] });
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    socketEmitter.emit.mockClear();
    seed(C);
    seed(OTHER);
});

describe('erasure by person', () => {
    it('withdraws the person\'s votes in that workspace, corrects each count, and counts them', async () => {
        const result = await controls.erasePerson(C, ALICE);

        expect(result).toMatchObject({ removed: { field_vote: 2 }, total: 2 });
        expect(votesOf(C, FIRST)).toMatchObject({ ids: [BOB], version: 3 });
        expect(tallyOf(C, FIRST)).toMatchObject({ fieldValue: 1, version: 3 });
        expect(votesOf(C, FIRST, MORE_VOTES)).toMatchObject({ ids: [], version: 2 });
        expect(tallyOf(C, FIRST, MORE_VOTES)).toEqual({ _id: MORE_VOTES, revision: expect.any(Number), version: 2 });
        expect(JSON.stringify(mockDbFor(C).store[LINKS].filter((row) => row.kind === 'voting'))).not.toContain(ALICE);
        expect(socketEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it('leaves other people\'s votes, linked tasks and other workspaces as they were', async () => {
        await controls.erasePerson(C, ALICE);

        expect(votesOf(C, SECOND)).toMatchObject({ ids: [BOB], version: 1 });
        expect(tallyOf(C, SECOND)).toMatchObject({ fieldValue: 1, revision: 5 });
        expect(votesOf(C, THIRD, CLIENT).ids).toEqual([ALICE, FIRST]);
        expect(votesOf(OTHER, FIRST).ids).toEqual([ALICE, BOB]);
        expect(tallyOf(OTHER, FIRST)).toMatchObject({ fieldValue: 2 });
    });

    it('says nothing was removed for a person who never voted, and for an id that names nobody', async () => {
        expect(await eraseVoter(C, '6f0000000000000000000099')).toBe(0);
        expect(await eraseVoter(C, { $ne: null })).toBe(0);
        expect(await eraseVoter(C, '')).toBe(0);
        expect((await controls.erasePerson(C, '6f0000000000000000000099')).removed.field_vote).toBeUndefined();
        expect(votesOf(C, FIRST).ids).toEqual([ALICE, BOB]);
    });
});
