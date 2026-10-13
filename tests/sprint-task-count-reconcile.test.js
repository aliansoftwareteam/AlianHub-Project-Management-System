const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const reconcile = require('../Modules/Tasks/helpers/reconcileTaskCount');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const SPRINT = '6f0000000000000000000a01';
const OTHER_SPRINT = '6f0000000000000000000a02';

const oid = (id) => new mongoose.Types.ObjectId(id);
const sprints = () => mockDb.store[SCHEMA_TYPE.SPRINTS];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { sprintId: oid(SPRINT), ...over });

describe('computeLiveTaskCount', () => {
    it('counts the tasks of that sprint that are not deleted', async () => {
        seedTask();
        seedTask({ deletedStatusKey: 0 });
        seedTask({ deletedStatusKey: 1 });
        seedTask({ sprintId: oid(OTHER_SPRINT) });
        expect(await reconcile.computeLiveTaskCount(COMPANY, SPRINT)).toBe(2);
    });

    it('is zero for an empty sprint', async () => {
        expect(await reconcile.computeLiveTaskCount(COMPANY, SPRINT)).toBe(0);
    });

    it('reads only the company it was asked for', async () => {
        seedTask();
        await reconcile.computeLiveTaskCount(COMPANY, SPRINT);
        expect(mockDb.calls.map((c) => c.companyId)).toEqual([COMPANY]);
    });

    it('refuses a missing or malformed sprint id', async () => {
        await expect(reconcile.computeLiveTaskCount(COMPANY, undefined)).rejects.toThrow(/invalid sprintId/);
        await expect(reconcile.computeLiveTaskCount(COMPANY, 'nope')).rejects.toThrow(/invalid sprintId/);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('reconcileSprintTaskCount', () => {
    it('writes the real count back onto a drifted sprint and returns it', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 9 });
        seedTask();
        seedTask();
        seedTask({ deletedStatusKey: 2 });
        expect(await reconcile.reconcileSprintTaskCount(COMPANY, SPRINT)).toBe(2);
        expect(sprints()[0].tasks).toBe(2);
    });

    it('brings a sprint with no live tasks down to zero', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 4 });
        expect(await reconcile.reconcileSprintTaskCount(COMPANY, SPRINT)).toBe(0);
        expect(sprints()[0].tasks).toBe(0);
    });

    it('leaves other sprints alone', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 9 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, tasks: 5 });
        await reconcile.reconcileSprintTaskCount(COMPANY, SPRINT);
        expect(sprints().find((s) => String(s._id) === OTHER_SPRINT).tasks).toBe(5);
    });

    it('reads and writes in the company it was given and no other', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 1 });
        await reconcile.reconcileSprintTaskCount(OTHER_COMPANY, SPRINT);
        expect(new Set(mockDb.calls.map((c) => c.companyId))).toEqual(new Set([OTHER_COMPANY]));
        expect(mockDb.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('returns null without touching the database for a missing or bad sprint id', async () => {
        expect(await reconcile.reconcileSprintTaskCount(COMPANY, undefined)).toBeNull();
        expect(await reconcile.reconcileSprintTaskCount(COMPANY, 'nope')).toBeNull();
        expect(mockDb.calls).toHaveLength(0);
    });

    it('returns null and logs when the database fails', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('db down'));
        expect(await reconcile.reconcileSprintTaskCount(COMPANY, SPRINT)).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
});

describe('scheduleReconciliation', () => {
    const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

    it('fixes every sprint it is given after the caller has moved on', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 7 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, tasks: 7 });
        seedTask();
        reconcile.scheduleReconciliation(COMPANY, [SPRINT, OTHER_SPRINT]);
        expect(sprints().map((s) => s.tasks)).toEqual([7, 7]);
        await flush();
        expect(sprints().find((s) => String(s._id) === SPRINT).tasks).toBe(1);
        expect(sprints().find((s) => String(s._id) === OTHER_SPRINT).tasks).toBe(0);
    });

    it('accepts a single id and skips blank ones', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, tasks: 7 });
        reconcile.scheduleReconciliation(COMPANY, SPRINT);
        reconcile.scheduleReconciliation(COMPANY, [null, undefined, '']);
        await flush();
        expect(sprints()[0].tasks).toBe(0);
    });
});
