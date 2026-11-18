process.env.STORAGE_TYPE = 'server';

const mockDb = { rows: {} };
const mockStubs = () => new Proxy({}, {
    get: (target, name) => {
        if (name === '__esModule' || name === 'then') return undefined;
        if (!target[name]) target[name] = jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn((db, query, method) => mockDb.crud(db, query, method)) }));
jest.mock('../Config/permissionGuard', () => {
    const { isPrivileged } = jest.requireActual('../Config/roleTypes');
    return { getRoleType: jest.fn(), isPrivileged, evaluatePermission: jest.fn(async () => 1), isReadable: (value) => Boolean(value) };
});
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn() }));
jest.mock('../Config/contentAccess', () => ({ projectAccess: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ canSeeSprintById: jest.fn(async () => true), hiddenSprintIds: jest.fn(async () => []) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({ SHEET_PERMISSION: {}, resolveSheetScope: jest.fn(), scopedTimeMatch: () => ({}) }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => mockStubs());
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => mockStubs());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStubs());
jest.mock('../Modules/Tasks/helpers/helper', () => mockStubs());
jest.mock('../Modules/Sprints/controller', () => mockStubs());
jest.mock('../Modules/notification-count/controller', () => mockStubs());
jest.mock('../Modules/Comments/controller', () => mockStubs());
jest.mock('../Modules/MainChats/controller', () => mockStubs());
jest.mock('../Modules/Auth/helper', () => mockStubs());
jest.mock('../Modules/Company/eventController.js', () => mockStubs());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStubs());
jest.mock('../utils/commonFunctions.js', () => mockStubs());
jest.mock('../Modules/serviceFunction', () => ({ sanitizeInput: (value) => value }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { getRoleType } = require('../Config/permissionGuard');
const { canReadProject } = require('../Config/projectAccess');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { handleTaskAttachmentsDuplicateFunctionality } = require('../common-storage/common-server.js');
const { ROLE_MEMBER } = require('../Config/roleTypes');
const { mergeTask } = require('../Modules/Tasks/helpers/taskMongo/mergeDuplicate');
const { requireStoredFileRead } = require('../Modules/storage/downloadScope');

const CID = '6f00000000000000000000c1';
const MEMBER = '6f0000000000000000000003';
const OUTSIDER = '6f0000000000000000000004';
const OPEN_PROJECT = '6f0000000000000000000a01';
const HIDDEN_PROJECT = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const SOURCE = '6f0000000000000000000b01';
const KEPT = '6f0000000000000000000b02';
const UNMERGED = '6f0000000000000000000b03';
const UNMERGED_HIDDEN = '6f0000000000000000000b04';

const fileOf = (projectId, taskId, name) => `Project/${projectId}/Sprint/${taskId}/Attachment/${name}`;
const SOURCE_FILE = fileOf(HIDDEN_PROJECT, SOURCE, '1700000000-spec.pdf');
const KEPT_FILE = fileOf(OPEN_PROJECT, KEPT, '1700000001-plan.pdf');
const UNMERGED_FILE = fileOf(OPEN_PROJECT, UNMERGED, '1700000002-notes.pdf');
const UNMERGED_HIDDEN_FILE = fileOf(HIDDEN_PROJECT, UNMERGED_HIDDEN, '1700000003-secret.pdf');
const DRIVE_LINK = 'https://drive.example.com/file/abc';

const READABLE = { [MEMBER]: [OPEN_PROJECT], [OUTSIDER]: [] };

const fieldValue = (doc, path) => path.split('.').reduce((values, part) => values.flatMap((value) => {
    if (value === null || value === undefined) return [];
    const next = value[part];
    return Array.isArray(next) ? next : [next];
}), [doc]).map(String);

const matches = (doc, query) => Object.entries(query).every(([field, want]) => {
    const have = fieldValue(doc, field);
    if (want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).some((op) => op.startsWith('$'))) {
        if (want.$in) return want.$in.some((value) => have.includes(String(value)));
        if (want.$nin) return !want.$nin.some((value) => have.includes(String(value)));
        throw new Error(`unsupported query ${JSON.stringify(want)}`);
    }
    return have.includes(String(want));
});

mockDb.crud = async (db, { type, data }, method) => {
    const [query, update] = data;
    const rows = (mockDb.rows[type] || []).filter((row) => matches(row, query));
    if (method === 'find') return rows;
    if (method === 'findOne') return rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null;
    if (method === 'findOneAndUpdate') {
        const row = rows[0];
        if (!row) return null;
        Object.assign(row, JSON.parse(JSON.stringify(update.$set || {})));
        Object.entries(update.$inc || {}).forEach(([field, by]) => { row[field] = (row[field] || 0) + by; });
        return JSON.parse(JSON.stringify(row));
    }
    throw new Error(`unsupported method ${method}`);
};

const task = (id, projectId, sprintId, attachments) => ({
    _id: id,
    ProjectID: projectId,
    sprintId,
    TaskName: `Task ${id.slice(-2)}`,
    isParentTask: true,
    sprintArray: { id: sprintId, name: 'Sprint', value: 'sprint' },
    attachments,
});

const record = (id, url) => ({ id, url, filename: url.split('/').pop(), userId: MEMBER });

beforeEach(() => {
    process.env.STORAGE_DOWNLOAD_SCOPE = 'enforce';
    handleTaskAttachmentsDuplicateFunctionality.mockReset().mockResolvedValue(true);
    mockDb.rows = {
        tasks: [
            task(SOURCE, HIDDEN_PROJECT, SPRINT, [record('source-file', SOURCE_FILE), record('source-link', DRIVE_LINK)]),
            task(KEPT, OPEN_PROJECT, OTHER_SPRINT, [record('kept-file', KEPT_FILE)]),
            task(UNMERGED, OPEN_PROJECT, OTHER_SPRINT, [record('unmerged-file', UNMERGED_FILE)]),
            task(UNMERGED_HIDDEN, HIDDEN_PROJECT, SPRINT, [record('unmerged-hidden-file', UNMERGED_HIDDEN_FILE)]),
        ],
    };
    getRoleType.mockImplementation(async () => ROLE_MEMBER);
    canReadProject.mockImplementation(async (companyId, uid, projectId) => ({ allowed: (READABLE[uid] || []).includes(String(projectId)) }));
    visibleProjectIds.mockImplementation(async (companyId, uid) => READABLE[uid] || []);
});

const settle = async () => {
    for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setImmediate(resolve));
};

const mergeSourceIntoKept = async () => {
    const outcome = await mergeTask({
        companyId: CID,
        projectData: { id: OPEN_PROJECT, ProjectName: 'Open' },
        oldProject: { id: HIDDEN_PROJECT, ProjectName: 'Hidden' },
        taskId: SOURCE,
        mergeTaskId: KEPT,
        isSubTask: false,
        userData: { id: MEMBER, Employee_Name: 'Member' },
    });
    await settle();
    return outcome;
};

const stored = (id) => mockDb.rows.tasks.find((row) => row._id === id);
const attachmentOf = (taskId, recordId) => stored(taskId).attachments.find((item) => item.id === recordId);

const download = (uid, key) => new Promise((resolve, reject) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { resolve({ allowed: false, status: res.statusCode, body }); return res; };
    const check = requireStoredFileRead(() => CID, () => key, { storage: 'server' });
    Promise.resolve(check({ uid, headers: { companyid: CID } }, res, () => resolve({ allowed: true }))).catch(reject);
});

describe('attachments a merge moves onto the kept task', () => {
    it('are downloadable under enforce by a member who can open the kept task but not the merged one', async () => {
        await mergeSourceIntoKept();
        const moved = attachmentOf(KEPT, 'source-file');
        expect(moved).toBeDefined();
        expect(await download(MEMBER, moved.url)).toEqual({ allowed: true });
    });

    it('are re-homed into the kept task folder and the stored file is copied there', async () => {
        await mergeSourceIntoKept();
        const moved = attachmentOf(KEPT, 'source-file');
        expect(moved.url).toBe(fileOf(OPEN_PROJECT, KEPT, '1700000000-spec.pdf'));
        expect(handleTaskAttachmentsDuplicateFunctionality).toHaveBeenCalledWith(CID, SOURCE_FILE, moved.url);
        expect(attachmentOf(KEPT, 'source-link').url).toBe(DRIVE_LINK);
        expect(attachmentOf(KEPT, 'kept-file').url).toBe(KEPT_FILE);
    });

    it('are refused under enforce to a caller who cannot open the kept task', async () => {
        await mergeSourceIntoKept();
        const moved = attachmentOf(KEPT, 'source-file');
        expect(await download(OUTSIDER, moved.url)).toMatchObject({ allowed: false, status: 404 });
        expect(await download(OUTSIDER, SOURCE_FILE)).toMatchObject({ allowed: false, status: 404 });
    });

    it('keep the merged task key when the copy fails, so access is never widened', async () => {
        handleTaskAttachmentsDuplicateFunctionality.mockRejectedValue(new Error('copy failed'));
        await mergeSourceIntoKept();
        const moved = attachmentOf(KEPT, 'source-file');
        expect(moved.url).toBe(SOURCE_FILE);
        expect(await download(MEMBER, moved.url)).toMatchObject({ allowed: false, status: 404 });
    });

    it('still soft-deletes the merged task and leaves its own record alone', async () => {
        await mergeSourceIntoKept();
        expect(stored(SOURCE).deletedStatusKey).toBe(1);
        expect(attachmentOf(SOURCE, 'source-file').url).toBe(SOURCE_FILE);
    });
});

describe('tasks no merge touched', () => {
    it('keep their attachments and download verdicts', async () => {
        const before = [await download(MEMBER, UNMERGED_FILE), await download(MEMBER, UNMERGED_HIDDEN_FILE), await download(OUTSIDER, UNMERGED_FILE)];
        await mergeSourceIntoKept();
        expect(attachmentOf(UNMERGED, 'unmerged-file').url).toBe(UNMERGED_FILE);
        expect(attachmentOf(UNMERGED_HIDDEN, 'unmerged-hidden-file').url).toBe(UNMERGED_HIDDEN_FILE);
        const after = [await download(MEMBER, UNMERGED_FILE), await download(MEMBER, UNMERGED_HIDDEN_FILE), await download(OUTSIDER, UNMERGED_FILE)];
        expect(after).toEqual(before);
        expect(before.map((verdict) => verdict.allowed)).toEqual([true, false, false]);
    });

    it('are judged the same before any merge happens', async () => {
        expect(await download(MEMBER, KEPT_FILE)).toEqual({ allowed: true });
        expect(await download(MEMBER, SOURCE_FILE)).toMatchObject({ allowed: false, status: 404 });
    });
});
