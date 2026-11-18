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
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/TimesheetApproval/helpers/lockGuard', () => ({ isPeriodLocked: jest.fn(async () => false), PERIOD_LOCKED: 'locked' }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateProjectForTimelog: jest.fn(async () => {}), updateRemainingTime: jest.fn(async () => {}) }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: jest.fn(async (req) => ({ id: String(req.uid), Employee_Name: 'Someone' })), escapeText: (text) => text }));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const reports = require('../Modules/CustomReports/controller');
const { workspaceRows } = require('../Modules/ExportJobs/controller');
const { trimTimer } = require('../Modules/LogTime/controllerV2/webTimer');
const { undoImport } = require('../Modules/Importers/controller');

const { CID, OWNER, ADMIN, INSIDER, P_OPEN, P_PERSONAL, T_OPEN, T_PERSONAL, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const MANAGERS = [['the owner', OWNER], ['an admin', ADMIN]];
const LOG_OPEN = '6f0000000000000000000f11';
const LOG_PERSONAL = '6f0000000000000000000f12';
const IMPORT_OPEN = '6f0000000000000000000f21';
const IMPORT_PERSONAL = '6f0000000000000000000f22';
const AT = Math.floor(Date.now() / 1000) - 7200;

const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handler(verified({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ...req }), res);
    await settle();
    return { code: res.statusCode, ...res.body };
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    [[LOG_OPEN, T_OPEN, P_OPEN], [LOG_PERSONAL, T_PERSONAL, P_PERSONAL]].forEach(([_id, TicketID, ProjectId]) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
        _id, TicketID, ProjectId, Loggeduser: INSIDER, LogStartTime: AT, LogTimeDuration: 120, startTimeTracker: AT + 60, LogDescription: 'Working',
    }));
    [[IMPORT_OPEN, T_OPEN, P_OPEN], [IMPORT_PERSONAL, T_PERSONAL, P_PERSONAL]].forEach(([_id, taskId, projectId]) => {
        mockDb.seed(SCHEMA_TYPE.IMPORT_JOBS, { _id, userId: INSIDER, projectId, source: 'csv', status: 'done' });
        task(taskId).importJobId = _id;
    });
});

describe('what an owner or an admin reads and changes across the workspace stops at the personal list of someone else', () => {
    it.each(MANAGERS)('a report %s builds counts no task and no time of it', async (who, uid) => {
        const byProject = await reports.runConfig(CID, { source: 'tasks', dimension: 'project', metric: 'count', chartType: 'bar', filters: {} }, uid);
        const hours = await reports.runConfig(CID, { source: 'timelogs', dimension: 'project', metric: 'hours', chartType: 'bar', filters: {} }, uid);

        expect(byProject.rows.map((row) => row.label).sort()).toEqual(['Open', 'Private']);
        expect(hours.rows.map((row) => row.value)).toEqual([2]);
        expect((await reports.runConfig(CID, { source: 'tasks', dimension: 'project', metric: 'count', chartType: 'bar', filters: {} }, INSIDER)).rows.map((row) => row.label).sort()).toEqual(['Open', 'Personal', 'Private']);
    });

    it.each(MANAGERS)('the export of the workspace %s makes holds no task of it', async (who, uid) => {
        const exported = JSON.stringify(await workspaceRows(CID, uid));
        expect([exported.includes('Open task'), exported.includes('Private task'), exported.includes('Personal task')]).toEqual([true, true, false]);
    });

    it.each(MANAGERS)('a timer kept there is not %s\'s to trim, and reads like one that is not there', async (who, uid) => {
        const missing = await answered(trimTimer, { uid, body: { timeSheetId: '6f0000000000000000000fff', minutes: 30 } });

        expect(await answered(trimTimer, { uid, body: { timeSheetId: LOG_PERSONAL, minutes: 30 } })).toEqual(missing);
        expect(rows(SCHEMA_TYPE.TIMESHEET).find((row) => String(row._id) === LOG_PERSONAL).LogTimeDuration).toBe(120);
        expect((await answered(trimTimer, { uid, body: { timeSheetId: LOG_OPEN, minutes: 30 } })).status).toBe(true);
    });

    it.each(MANAGERS)('an import made into it is not %s\'s to undo, and reads like one that is not there', async (who, uid) => {
        const missing = await answered(undoImport, { uid, params: { id: '6f0000000000000000000fff' } });

        expect(await answered(undoImport, { uid, params: { id: IMPORT_PERSONAL } })).toEqual(missing);
        expect(task(T_PERSONAL).deletedStatusKey).toBe(0);
        expect((await answered(undoImport, { uid, params: { id: IMPORT_OPEN } })).code).not.toBe(404);
    });
});
