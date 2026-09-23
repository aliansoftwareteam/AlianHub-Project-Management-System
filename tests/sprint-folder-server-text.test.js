const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCount: jest.fn(), unsetAllCounts: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Auth/helper', () => ({ replaceObjectKey: jest.fn() }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));

const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateSprint } = require('../Modules/Project/controller/updateSprint');
const sprintHistory = () => require('../Modules/Sprints/helpers/sprintHistory');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000a01';
const FOLDER = '6f0000000000000000000f01';
const SPRINT = '6f0000000000000000000e01';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};

const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const notices = () => HandleBothNotification.mock.calls.map(([args]) => args);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Parity', CompanyId: CID });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: FOLDER, name: 'Design', projectId: PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Backlog', projectId: PROJECT, deletedStatusKey: 0, favouriteTasks: [] });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
});

/* The sprint controller declares a parameter named `private`, which the test transform refuses; its wiring is covered by
   tests/integration/project-history-server-text.int.test.js, and the text it sends is built by these helpers. */
describe('creating a sprint or folder notifies from the server', () => {
    test('a sprint names the stored project and escapes its own name', async () => {
        await sprintHistory().notifySprintCreated({ companyId: CID, projectId: PROJECT, sprintName: `Sprint ${HTML}`, actorId: OWNER });
        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({
            type: 'project',
            companyId: CID,
            projectId: PROJECT,
            object: { key: 'project_sprint_create', message: `<p>Created new <strong>Sprint</strong> named <strong>Sprint ${ESCAPED}</strong> in <strong>Parity</strong> project.</p>` },
            changeType: 'sprint_create',
            changeData: { ProjectName: 'Parity', sprintName: `Sprint ${ESCAPED}` },
        });
        expect(notices()[0].userData).toEqual({ id: OWNER, Employee_Name: 'Olivia Owner', companyOwnerId: OWNER });
    });

    test('a folder names the stored project', async () => {
        await sprintHistory().notifyFolderCreated({ companyId: CID, projectId: PROJECT, folderName: 'Research', actorId: OWNER });
        expect(notices()[0]).toMatchObject({
            object: { key: 'project_folder_create', message: '<p>Created new <strong>Folder</strong> named <strong>Research</strong> in <strong>Parity</strong> project.</p>' },
            changeType: 'folder_create',
            changeData: { ProjectName: 'Parity', sprintFolderName: 'Research' },
        });
    });
});

describe('sprint and folder history names what is stored', () => {
    test('the project, the folder and a sprint\'s stored name', async () => {
        const names = await sprintHistory().storedNames(CID, { projectId: PROJECT, folderId: FOLDER, sprintId: SPRINT });
        expect(names).toEqual({ projectName: 'Parity', folderName: 'Design', sprintName: 'Backlog' });
    });

    test('without a sprint, and nothing for ids that are not stored', async () => {
        expect(await sprintHistory().storedNames(CID, { projectId: PROJECT, folderId: FOLDER })).toEqual({ projectName: 'Parity', folderName: 'Design' });
        expect(await sprintHistory().storedNames(CID, { projectId: 'nope', folderId: HTML })).toEqual({ projectName: '', folderName: '' });
    });
});

describe('favouriting a sprint is described on the server', () => {
    const favourite = (key, uid = OWNER) => {
        const r = reply();
        return Promise.resolve(updateSprint({ headers: { companyid: CID }, params: { id: SPRINT }, body: { updateObject: { favouriteTasks: { userId: uid } }, key, message: HTML }, uid }, r))
            .then(settle)
            .then(() => r);
    };

    test('marking a favourite names the stored sprint and project', async () => {
        const r = await favourite('$addToSet');
        expect(r.code).toBe(200);
        const rows = historyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ Type: 'project', Key: 'Create_Sprint', UserId: OWNER, ProjectId: PROJECT });
        expect(rows[0].Message).toBe('<b>Olivia Owner</b> has set <b>Backlog</b> sprint as favorite in <b>Parity</b> project.');
    });

    test('removing a favourite, or one already marked, records nothing', async () => {
        await favourite('$pull');
        mockDb.store[SCHEMA_TYPE.SPRINTS][0].favouriteTasks = [{ userId: OWNER }];
        await favourite('$addToSet');
        expect(historyRows()).toEqual([]);
    });
});
