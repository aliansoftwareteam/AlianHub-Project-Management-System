const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const audit = require('../Modules/Agents/agentAudit');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { undoStateOf, undoAuditRow, REASON } = require('../Modules/Agents/undo');
const { READERS } = require('../Modules/Agents/skills/readers');

const { C, PEOPLE, PROJECTS, PAGES } = world;

const draftedPage = (pageId, kind) => ({
    action: audit.ACTION_DONE,
    createdAt: new Date(),
    projectId: PROJECTS.open,
    meta: { undo: { kind, pageId } },
});

const undoable = (kind) => world.askEveryone(async (uid) => {
    const states = await Promise.all(world.pageRows().map(async (page) => ({
        _id: page._id,
        state: await undoStateOf(C, draftedPage(page._id, kind), { userId: uid }, { undoHours: 24, run: null }),
    })));
    return states.filter(({ state }) => state.undoable);
});

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: undoing an agent\'s page', () => {
    const EXPECTED = {
        owner: ['shared', 'company', 'closed'],
        admin: ['shared', 'company', 'closed'],
        inside: ['insidePrivate', 'shared', 'company', 'closed'],
        outside: ['outsidePrivate', 'shared', 'company'],
        guest: ['shared', 'company'],
    };

    it.each(['page', 'pageVersion'])('offers undo of a %s action filed under a project the person can open', async (kind) => {
        expect(await undoable(kind)).toEqual(EXPECTED);
    });

    it('runs the undo only for a page the person can change', async () => {
        const stored = () => mockDb.store[SCHEMA_TYPE.PAGES].find((page) => String(page._id) === PAGES.closed);
        const undo = (who) => undoAuditRow(C, draftedPage(PAGES.closed, 'page'), { userId: PEOPLE[who] }, '127.0.0.1', { undoHours: 24, run: null });

        expect(await undo('outside')).toMatchObject({ ok: false, reason: REASON.TARGET_NOT_VISIBLE });
        expect(stored().deletedStatusKey).toBe(0);
        expect(await undo('inside')).toMatchObject({ ok: true });
        expect(stored().deletedStatusKey).toBe(1);
    });
});

describe('the page readers give the same answer: the doc an agent reads for a task', () => {
    const OTHER_TASK = 'd000000000000000000000d2';
    const linked = (doc) => mockDb.seed(SCHEMA_TYPE.PAGES, { createdBy: PEOPLE.owner, ProjectID: PROJECTS.open, deletedStatusKey: 0, linkedTasks: [OTHER_TASK], ...doc });
    const read = () => READERS.linked_doc(C, { task: { _id: OTHER_TASK } }, { maxChars: 200 });

    it('reads a linked doc that is not private, whether or not the row records its visibility', async () => {
        linked({ title: 'Atlas kept back', rawText: 'kept back', visibility: 'private' });
        expect(await read()).toEqual({ skip: 'no document is attached to this task' });

        linked({ title: 'Atlas early', rawText: 'early notes' });
        expect(await read()).toMatchObject({ title: 'Atlas early', text: 'early notes' });
    });
});
