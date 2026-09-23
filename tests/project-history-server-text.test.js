const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ TRASHED: 1, quotaStatus: () => null, syncProjectQuota: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ guideTouched: () => false, publishGuideSaved: jest.fn(), publishProjectTrashed: jest.fn(), publishProjectRestored: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Auth/helper', () => ({ replaceObjectKey: jest.fn() }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCount: jest.fn(), unsetAllCounts: jest.fn() }));

const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateProject } = require('../Modules/Project/controller/updateProject');
const describeProjectChanges = (...args) => require('../Modules/Project/helpers/projectHistory').describeProjectChanges(...args);

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const PROJECT = '6f0000000000000000000a01';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';
const PILL = '<strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">';

const ACTIVE = { value: 'active', name: 'Active', type: 'default_active', backgroundColor: '#e5f5ea', textColor: '#1f8a3b' };
const ON_HOLD = { value: 'on_hold', name: 'On Hold', type: 'active', backgroundColor: '#fff4e0', textColor: '#b86e00' };
const CLOSED = { value: 'closed', name: 'Closed', type: 'close', backgroundColor: '#eeeeee', textColor: '#555555' };

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};

const update = async (body, uid = OWNER, projectId = PROJECT) => {
    const r = reply();
    await updateProject({ headers: { companyid: CID }, params: { id: projectId }, body, query: {}, uid }, r);
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

const seed = (over = {}) => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PROJECT,
        ProjectName: 'Parity',
        CompanyId: CID,
        status: 'active',
        statusType: 'default_active',
        projectStatusData: [ACTIVE, ON_HOLD, CLOSED],
        deletedStatusKey: 0,
        AssigneeUserId: [OWNER, MEMBER],
        LeadUserId: [OWNER],
        ProjectType: 'Fixed',
        ProjectCurrency: { _id: 'c1', code: 'USD', name: 'US Dollar', symbol: '$' },
        projectIcon: { type: 'color', data: '#6473e8' },
        isPrivateSpace: false,
        watchers: { [OWNER]: 'participating_mentions' },
        ...over,
    });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: GUEST, Employee_Name: 'Gia Guest' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
};

const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const messages = () => historyRows().map((row) => [row.Key, row.Message]);
const notices = () => HandleBothNotification.mock.calls.map(([args]) => args);
const noticeTexts = () => notices().map((sent) => [sent.object.key, sent.object.message]);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    seed();
});

describe('a project change is described on the server after the write', () => {
    test('a rename names the stored name and the new one, and the signed-in user', async () => {
        const r = await update({ updateObject: { ProjectName: 'Parity Two' } });
        expect(r.code).toBe(200);

        const rows = historyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ Type: 'project', Key: 'Project_Name', UserId: OWNER, ProjectId: PROJECT, TaskId: '' });
        expect(rows[0].Message).toBe('<b>Olivia Owner</b> has changed the name of <b>Parity</b> to <b>Parity Two</b>');

        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({ type: 'project', companyId: CID, projectId: PROJECT, changeType: 'name', changeData: { TaskName: 'Parity Two', previousTaskName: 'Parity' } });
        expect(notices()[0].userData).toEqual({ id: OWNER, Employee_Name: 'Olivia Owner', companyOwnerId: OWNER });
        expect(notices()[0].object).toEqual({ key: 'project_name', message: '<p>Project name is changed from <strong> Parity</strong> to <strong> Parity Two </strong>.</p>' });
    });

    test('text and a user the request carries are ignored, and names are escaped', async () => {
        const r = await update({
            updateObject: { ProjectName: `Parity ${HTML}` },
            message: `<p>${HTML}</p>`,
            historyObj: { key: 'Project_Name', message: HTML },
            notificationObj: { key: 'project_name', message: HTML },
            userData: { id: OWNER, Employee_Name: HTML, companyOwnerId: GUEST },
        }, MEMBER);
        expect(r.code).toBe(200);

        const [row] = historyRows();
        expect(row.UserId).toBe(MEMBER);
        expect(row.Message).toBe(`<b>Max Member</b> has changed the name of <b>Parity</b> to <b>Parity ${ESCAPED}</b>`);
        const [sent] = notices();
        expect(sent.userData).toEqual({ id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER });
        expect(sent.object.message).not.toContain('<img');
        expect(sent.object.message).toContain(ESCAPED);
    });

    test('closing names the stored project', async () => {
        await update({ updateObject: { status: 'closed', statusType: 'close' } });
        expect(messages()).toEqual([['Project_Name', '<b>Olivia Owner</b> has closed the <b>Parity</b> Project']]);
        expect(noticeTexts()).toEqual([['project_close', '<p><strong>Olivia Owner</strong> has closed the <strong>Parity</strong> Project</p>']]);
        expect(notices()[0]).toMatchObject({ changeType: 'project_close', changeData: { projectName: 'Parity', userName: 'Olivia Owner' } });
    });

    test('reopening a closed project', async () => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        seed({ status: 'closed', statusType: 'close' });
        await update({ updateObject: { status: 'active', statusType: 'default_active' } });
        expect(messages()).toEqual([['Project_EndDate', '<b>Olivia Owner</b> has reopened <b>Parity</b> Project.']]);
        expect(notices()).toEqual([]);
    });

    test.each([
        [2, 0, 'archived'],
        [1, 0, 'deleted'],
        [0, 1, 'restored'],
        [0, 2, 'restored'],
    ])('deletedStatusKey %s from %s reads as %s', async (next, stored, verb) => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        seed({ deletedStatusKey: stored });
        await update({ updateObject: { deletedStatusKey: next } });
        expect(messages()).toEqual([['Project_Name', `<b>Olivia Owner</b> has ${verb} the <b>Parity</b> Project`]]);
        expect(noticeTexts()).toEqual([['project_close', `<p><strong>Olivia Owner</strong> has ${verb} the <strong>Parity</strong> Project</p>`]]);
    });

    test('a status change takes both colours from the stored status list', async () => {
        await update({ updateObject: { status: 'on_hold', statusType: 'active' } });
        expect(messages()).toEqual([['Project_Status', '<b>Olivia Owner</b> has changed <b> Status</b> as <b>On Hold</b>.']]);
        expect(noticeTexts()).toEqual([['project_status_change', '<p>Status of <strong>Parity</strong> is changed from <span style="background-color:#e5f5ea; color:#1f8a3b;padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;">Active</span> to <span style="font-weight: 500;background-color:#fff4e0; color:#b86e00;padding-right: 5px;padding-left: 5px;border-radius: 5px;">On Hold</span>.</p>']]);
        expect(notices()[0]).toMatchObject({ changeType: 'status', changeData: { ProjectName: 'Parity', statusName: 'Active', newStatusName: 'On Hold', backColor: '#e5f5ea', color: '#1f8a3b', bgColor: '#fff4e0', textColor: '#b86e00' } });
    });

    test('a status list replaced from the settings is not recorded as a status change', async () => {
        await update({ updateObject: { status: 'on_hold', statusType: 'active', projectStatusData: [ACTIVE, ON_HOLD, CLOSED] } });
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('an assignee added names the user from the stored users and mentions them', async () => {
        await update({ updateObject: { AssigneeUserId: GUEST }, key: '$addToSet' });
        expect(messages()).toEqual([['Project_Assignee_Add', '<b>Olivia Owner</b> has added the <b>Gia Guest</b> to <b>Assignee</b>.']]);
        expect(noticeTexts()).toEqual([['project_assignee', '<p><strong>Parity</strong> project is Assigned to <strong>Gia Guest</strong>.</p>']]);
        expect(notices()[0]).toMatchObject({ mentionUserId: [GUEST], changeType: 'assignee', changeData: { projectName: 'Parity', Employee_Name: 'Gia Guest', type: 'add', name: 'Gia Guest' } });
    });

    test('an assignee removed', async () => {
        await update({ updateObject: { AssigneeUserId: MEMBER }, key: '$pull' });
        expect(messages()).toEqual([['Project_Assignee_Removed', '<b>Olivia Owner</b> has removed the <b>Max Member</b> to <b>Assignee</b>.']]);
        expect(noticeTexts()).toEqual([['project_assignee', '<p><strong>Max Member</strong> is Removed from <strong>Parity</strong> project.</p>']]);
    });

    test('adding someone already assigned records nothing', async () => {
        await update({ updateObject: { AssigneeUserId: MEMBER }, key: '$addToSet' });
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('a type change names the stored type', async () => {
        await update({ updateObject: { ProjectType: 'Hourly', BillingPeriod: 'Monthly' } });
        expect(messages()).toEqual([['Project_Type', '<b>Olivia Owner</b> has changed <b> Type</b> as <b>Hourly</b>.']]);
        expect(noticeTexts()).toEqual([['project_type', '<p>Project Type of <strong>Parity</strong> is changed from <strong>Fixed</strong> to <strong>Hourly</strong>.</p>']]);
    });

    test('a currency change names the stored currency', async () => {
        await update({ updateObject: { ProjectCurrency: { _id: 'c2', code: 'EUR', name: 'Euro', symbol: 'E' } } });
        expect(messages()).toEqual([['Project_Currency', '<b>Olivia Owner</b> has changed <b> Currency</b> as <b>Euro</b>.']]);
        expect(noticeTexts()).toEqual([['project_currency', '<p>Project Currency of <strong>Parity</strong> is changed from <strong>US Dollar</strong> to <strong>Euro</strong>.</p>']]);
    });

    test('a first due date is added, in the caller\'s time zone', async () => {
        const due = '2026-09-30T18:30:00.000Z';
        await update({ updateObject: { DueDate: due, dueDateDeadLine: [{ date: due }] }, timeZone: 'Asia/Kolkata' });
        expect(messages()).toEqual([['Project_DueDate', `<b>Olivia Owner</b> has changed <b> Due Date</b> as <b>DATE_${new Date(due).getTime()}</b>.`]]);
        expect(noticeTexts()).toEqual([['project_due_date', `<p>Due Date of <strong>Parity</strong> project is added as ${PILL}01 Oct, 2026</span></strong>.</p>`]]);
    });

    test('a changed start date names the stored one', async () => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        seed({ StartDate: new Date('2026-09-01T00:00:00.000Z') });
        await update({ updateObject: { StartDate: '2026-09-15T00:00:00.000Z' }, timeZone: 'UTC' });
        expect(messages()).toEqual([['Project_StartDate', `<b>Olivia Owner</b> has changed <b> Start Date</b> as <b>DATE_${new Date('2026-09-15T00:00:00.000Z').getTime()}</b>.`]]);
        expect(noticeTexts()).toEqual([['project_start_date', `<p>Start Date of <strong>Parity</strong> project is changed from ${PILL}01 Sep, 2026</span></strong> to ${PILL}15 Sep, 2026</span></strong>.</p>`]]);
    });

    test('an end date with no time zone is shown in UTC', async () => {
        await update({ updateObject: { EndDate: '2026-12-31T00:00:00.000Z' }, timeZone: 'Mars/Olympus' });
        expect(noticeTexts()).toEqual([['project_end_date', `<p>End Date of <strong>Parity</strong> project is added as ${PILL}31 Dec, 2026</span></strong>.</p>`]]);
        expect(messages()[0][0]).toBe('Project_EndDate');
    });

    test('a new colour or avatar', async () => {
        await update({ updateObject: { projectIcon: { type: 'color', data: '#ff0000' } } });
        await update({ updateObject: { projectIcon: { type: 'image', data: 'uploads/avatar.png' } } });
        expect(messages()).toEqual([
            ['Project_EndDate', '<b>Olivia Owner</b> has changed <b> color </b>.'],
            ['Project_EndDate', '<b>Olivia Owner</b> has changed <b> avatar </b>.'],
        ]);
        expect(notices()).toEqual([]);
    });

    test('sharing the project privately', async () => {
        await update({ updateObject: { isPrivateSpace: true } });
        expect(messages()).toEqual([['Project_EndDate', '<b>Olivia Owner</b> has changed <b>Share with option</b> as <b>private</b>.']]);
    });

    test('a save that leaves every field as stored records nothing', async () => {
        await update({ updateObject: { ProjectName: 'Parity', ProjectType: 'Fixed', status: 'active', statusType: 'default_active', deletedStatusKey: 0, isPrivateSpace: false } });
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('fields the web app never recorded stay silent', async () => {
        await update({ updateObject: { ProjectRequiredComponent: [], apps: ['CustomFields'], descriptionBlock: [], isGlobalPermission: true } });
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('a refused save records nothing', async () => {
        const r = await update({ updateObject: { ProjectName: 'Elsewhere' } }, OWNER, 'not-an-id');
        expect(r.code).toBe(400);
        expect(historyRows()).toEqual([]);
        expect(notices()).toEqual([]);
    });
});

describe('a watch mode change is described from the stored watchers', () => {
    const previous = { _id: PROJECT, ProjectName: 'Parity', watchers: { [OWNER]: 'participating_mentions' } };
    const describe$ = (updateObject, key, actorId = OWNER) => describeProjectChanges({ previous, updateObject, key, actor: { id: actorId, Employee_Name: 'Olivia Owner' }, nameOf: async () => '' });

    test('switching to all activity', async () => {
        const [entry] = await describe$({ [`watchers.${OWNER}`]: 'all_activity' });
        expect(entry.history).toEqual({ key: 'Project_Watchers', message: '<b>Olivia Owner</b> has watchers activity as a <b>All Activity</b>' });
    });

    test('switching to ignore, and a first watch with a mode other than the default', async () => {
        expect((await describe$({ [`watchers.${OWNER}`]: 'ignore' }))[0].history.message).toBe('<b>Olivia Owner</b> has watchers activity as a <b>Ignore</b>');
        const [entry] = await describe$({ [`watchers.${MEMBER}`]: 'all_activity' }, undefined, MEMBER);
        expect(entry.history.message).toBe('<b>Olivia Owner</b> has watchers activity as a <b>All Activity</b>');
    });

    test('watching with the default mode, unwatching and another user\'s mode record nothing', async () => {
        expect(await describe$({ [`watchers.${MEMBER}`]: 'participating_mentions' }, undefined, MEMBER)).toEqual([]);
        expect(await describe$({ [`watchers.${OWNER}`]: 1 }, '$unset')).toEqual([]);
        expect(await describe$({ [`watchers.${MEMBER}`]: 'all_activity' })).toEqual([]);
    });
});

describe('the generic routes leave project changes to the server', () => {
    const historyBody = (key) => ({
        type: 'project',
        companyId: CID,
        projectId: PROJECT,
        taskId: null,
        object: { key, message: `<b>${HTML}</b>` },
        userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
    });

    test.each([
        'Project_Status', 'Project_Assignee_Add', 'Project_Assignee_Removed', 'Assignee_Changed', 'Project_Type', 'Project_Currency',
        'Project_DueDate', 'Project_StartDate', 'Project_EndDate', 'Project_Watchers', 'Project_Created', 'Create_Sprint',
    ])('a %s history row sent by the web app is not stored', async (key) => {
        const r = await post('/api/v1/handleHistory', historyBody(key));
        expect(r.body).toMatchObject({ status: true });
        expect(historyRows()).toEqual([]);
    });

    test.each([
        'project_name', 'project_close', 'project_status_change', 'project_assignee', 'project_type', 'project_currency',
        'project_due_date', 'project_start_date', 'project_end_date', 'project_create', 'project_sprint_create', 'project_folder_create',
    ])('a %s notification sent by the web app is not sent', async (key) => {
        const r = await post('/api/v1/handleNotification', {
            type: 'project',
            companyId: CID,
            projectId: PROJECT,
            userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
            object: { key, message: `<p>${HTML}</p>` },
        });
        expect(r.body).toMatchObject({ status: true });
        expect(HandleBothNotification).not.toHaveBeenCalled();
    });

    test('a task row under a project key and project rows the server does not build still go through', async () => {
        await post('/api/v1/handleHistory', { ...historyBody('Project_Name') });
        await post('/api/v1/handleHistory', { ...historyBody('Project_Status'), type: 'task', taskId: '6f0000000000000000000b01' });
        expect(historyRows().map((row) => row.Key)).toEqual(['Project_Name', 'Project_Status']);
    });
});
