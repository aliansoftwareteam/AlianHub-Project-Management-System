const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({
    resolveSheetScope: jest.fn(),
    SHEET_PERMISSION: { workload: 'sheet_settings.workload_timesheet', project: 'sheet_settings.project_timesheet' },
    scopedEstimateMatch: () => ({}),
}));
jest.mock('../Modules/TimeSheet/helpers/timesheetQueryScope', () => ({ scopeEstimatePipeline: jest.fn(), TimesheetQueryRefused: class extends Error {} }));
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({ estimateAndPersist: jest.fn(), _internal: {} }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/helper', () => ({ replaceObjectKey: jest.fn() }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCount: jest.fn(), unsetAllCounts: jest.fn() }));

const { resolveSheetScope } = require('../Modules/TimeSheet/helpers/timeScope');
const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const templates = require('../Modules/Tasks/helpers/notificationTemplate');
const estimates = require('../Modules/EstimatedTime/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000e01';
const FOLDER = '6f0000000000000000000f01';
const HTML = '<img src=x onerror=alert(1)>';
const DAY = '2026-10-01T00:00:00.000Z';
const IST_MIDNIGHT = '2026-09-30T18:30:00.000Z';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};

const save = async (body, uid = MEMBER) => {
    const r = reply();
    await estimates.updateEstimatedTime({ headers: { companyid: CID }, body, query: {}, params: {}, uid }, r);
    await settle();
    return r;
};

const handlers = {};
const app = { post: (path, ...fns) => { handlers[`POST ${path}`] = fns[fns.length - 1]; }, get: () => {}, put: () => {} };
require('../Modules/notification1/routes').init(app);
const post = async (path, body, uid = MEMBER) => {
    const r = reply();
    await handlers[`POST ${path}`]({ headers: { companyid: CID }, body, uid }, r);
    await settle();
    return r;
};

const everyone = (uid) => ({ uid, roleType: uid === OWNER ? 1 : 3, companyWide: uid === OWNER, everyone: uid === OWNER, visible: uid === OWNER ? null : [PROJECT] });

const seedNames = ({ taskName = 'Plan task', projectName = 'Parity', memberName = 'Max Member' } = {}) => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: projectName, CompanyId: CID });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, TaskName: taskName, ProjectID: PROJECT, CompanyId: CID, sprintId: SPRINT, folderObjId: FOLDER });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: memberName });
};

const planRow = (userId, minutes, date = DAY) => mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { _id: '6f0000000000000000000d01', UserId: userId, userId, TaskId: TASK, ProjectId: PROJECT, Date: new Date(date), EstimatedTime: minutes });

const plan = (over = {}) => ({ userId: MEMBER, taskId: TASK, projectId: PROJECT, date: DAY, minutes: 90, timeZone: 'UTC', ...over });

const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const notices = () => HandleBothNotification.mock.calls.map(([args]) => args);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    resolveSheetScope.mockImplementation(async (company, uid) => everyone(uid));
    seedNames();
});

describe('a planned estimate is described on the server', () => {
    test('a member planning their own time for a new day', async () => {
        const r = await save(plan());
        expect(r.code).toBe(200);

        const rows = historyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ Type: 'task', Key: 'Task_Due_Date', UserId: MEMBER, ProjectId: PROJECT, TaskId: TASK });
        expect(rows[0].Message).toBe('<b>Max Member</b> has added <b>hrs(01:30)</b> <b>estimated time</b> for<b> 01/10/2026</b>.');

        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({ type: 'tasks', companyId: CID, projectId: PROJECT, taskId: TASK, sprintId: SPRINT, folderId: FOLDER });
        expect(notices()[0].userData.id).toBe(MEMBER);
        expect(notices()[0].object).toEqual({
            key: 'task_estimated_hours',
            message: templates.estimatedTimeAdded({ loggedUserName: 'Max Member', updateEstimatedTime: '01:30', timeDateData: '01/10/2026', TaskName: 'Plan task', ProjectName: 'Parity' }),
        });
    });

    test('a member changing a day they already planned', async () => {
        planRow(MEMBER, 60);
        const r = await save(plan({ id: '6f0000000000000000000d01', minutes: 150 }));
        expect(r.code).toBe(200);

        expect(historyRows().map((row) => row.Message)).toEqual(['<b>Max Member</b> has updated <b>estimated time</b> for <b>01/10/2026</b> from <b>hrs(01:00)</b> to <b>hrs(02:30)</b>.']);
        expect(notices().map((sent) => sent.object.message)).toEqual([
            templates.estimatedTimeUpdated({ loggedUserName: 'Max Member', estimatedTime: '01:00', updateEstimatedTime: '02:30', timeDateData: '01/10/2026', TaskName: 'Plan task', ProjectName: 'Parity' }),
        ]);
    });

    test('an owner planning a member\'s time for a new day', async () => {
        const r = await save(plan({ minutes: 45 }), OWNER);
        expect(r.code).toBe(200);

        const [row] = historyRows();
        expect(row.UserId).toBe(OWNER);
        expect(row.Message).toBe('<b>Olivia Owner</b> added <b>hrs(00:45)</b> in <b>estimated time</b> of <b>Max Member</b> for <b>01/10/2026</b>.');
        expect(notices().map((sent) => sent.object.message)).toEqual([
            templates.estimatedTimeAssignAdded({ userName: 'Olivia Owner', loggedUserName: 'Max Member', updateEstimatedTime: '00:45', timeDateData: '01/10/2026', TaskName: 'Plan task', ProjectName: 'Parity' }),
        ]);
    });

    test('an owner changing a member\'s planned day', async () => {
        planRow(MEMBER, 30);
        const r = await save(plan({ minutes: 120 }), OWNER);
        expect(r.code).toBe(200);

        expect(historyRows().map((row) => row.Message)).toEqual(['<b>Olivia Owner</b> updated the <b>estimated time</b> of <b>Max Member</b> for <b>01/10/2026</b> from <b>00:30</b> to <b>02:00</b>.']);
        expect(notices().map((sent) => sent.object.message)).toEqual([
            templates.estimatedTimeAssignUpdated({ userName: 'Olivia Owner', loggedUserName: 'Max Member', estimatedTime: '00:30', updateEstimatedTime: '02:00', timeDateData: '01/10/2026', TaskName: 'Plan task', ProjectName: 'Parity' }),
        ]);
    });

    test('text the request sends is ignored and the actor is the signed-in user', async () => {
        const r = await save(plan({
            message: `<p>${HTML}</p>`,
            historyObj: { key: 'Task_Due_Date', message: HTML },
            notificationObj: { key: 'task_estimated_hours', message: HTML },
            userData: { id: OWNER, Employee_Name: HTML },
            TaskName: HTML,
            ProjectName: HTML,
        }));
        expect(r.code).toBe(200);

        const [row] = historyRows();
        expect(row.UserId).toBe(MEMBER);
        expect(row.Message).toBe('<b>Max Member</b> has added <b>hrs(01:30)</b> <b>estimated time</b> for<b> 01/10/2026</b>.');
        const [sent] = notices();
        expect(sent.userData.id).toBe(MEMBER);
        expect(sent.object.message).not.toMatch(/img|onerror/);
    });

    test('stored names are escaped', async () => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        seedNames({ taskName: HTML, projectName: HTML, memberName: `Max ${HTML}` });
        const r = await save(plan(), OWNER);
        expect(r.code).toBe(200);

        const [row] = historyRows();
        expect(row.Message).toContain('of <b>Max &lt;img src=x onerror=alert&#40;1&#41;&gt;</b>');
        expect(row.Message).not.toContain('<img');
        const [sent] = notices();
        expect(sent.object.message).not.toContain('<img');
        expect(sent.object.message).toContain('&lt;img');
    });

    test('the day is shown in the caller\'s time zone', async () => {
        const r = await save(plan({ date: IST_MIDNIGHT, timeZone: 'Asia/Kolkata' }));
        expect(r.code).toBe(200);
        expect(historyRows()[0].Message).toContain('for<b> 01/10/2026</b>');
    });

    test('an unknown time zone falls back to UTC', async () => {
        const r = await save(plan({ timeZone: 'Mars/Olympus' }));
        expect(r.code).toBe(200);
        expect(historyRows()[0].Message).toContain('for<b> 01/10/2026</b>');
    });

    test('a save that leaves the planned time as it was records nothing', async () => {
        planRow(MEMBER, 90);
        const r = await save(plan({ minutes: 90 }));
        expect(r.code).toBe(200);
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('a refused save records nothing', async () => {
        const r = await save(plan({ userId: OWNER }));
        expect(r.code).toBe(403);
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });
});

describe('the generic history and notification routes leave planned estimates to the server', () => {
    const historyBody = (key) => ({
        type: 'task',
        companyId: CID,
        projectId: PROJECT,
        taskId: TASK,
        object: { sprintId: SPRINT, key, message: `<b>${HTML}</b>` },
        userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
    });

    test('a planned estimate history row sent by the web app is not stored', async () => {
        const r = await post('/api/v1/handleHistory', historyBody('Task_Due_Date'));
        expect(r.body).toMatchObject({ status: true });
        expect(historyRows()).toEqual([]);
    });

    test('a planned estimate notification sent by the web app is not sent', async () => {
        const r = await post('/api/v1/handleNotification', {
            type: 'tasks',
            companyId: CID,
            projectId: PROJECT,
            taskId: TASK,
            sprintId: SPRINT,
            userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
            object: { key: 'task_estimated_hours', message: `<p>${HTML}</p>` },
        });
        expect(r.body).toMatchObject({ status: true });
        expect(HandleBothNotification).not.toHaveBeenCalled();
    });

    test('other history rows still go through', async () => {
        const r = await post('/api/v1/handleHistory', historyBody('task_checklist'));
        expect(r.body).toMatchObject({ status: true });
        expect(historyRows().map((row) => row.Key)).toEqual(['task_checklist']);
    });
});
