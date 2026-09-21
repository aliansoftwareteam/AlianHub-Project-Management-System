const mockDb = { rows: {} };

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn((db, query, method) => mockDb.crud(db, query, method)) }));
jest.mock('../Config/permissionGuard', () => {
    const { isPrivileged } = jest.requireActual('../Config/roleTypes');
    return {
        getRoleType: jest.fn(),
        isPrivileged,
        evaluatePermission: jest.fn(),
        isReadable: (permission) => permission !== null && permission !== undefined && permission !== 0,
    };
});
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn() }));
jest.mock('../Config/contentAccess', () => ({ projectAccess: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ canSeeSprintById: jest.fn() }));
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({
    SHEET_PERMISSION: { user: 'u', project: 'p', workload: 'w', tracker: 't' },
    resolveSheetScope: jest.fn(),
    scopedTimeMatch: (scope) => (scope.everyone ? {} : { Loggeduser: scope.uid }),
}));
jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: (req, res, next) => next() }));
jest.mock('../Modules/storage/server/helpers/bucket.helper', () => ({ upload: { single: () => (req, res, next) => next() }, validatePath: (req, res, next) => next() }));
jest.mock('../common-storage/common-server.js', () => ({
    handleProfileGetForUser: (req, res) => res.send({ status: true, statusText: 'signed' }),
    handleTaskTypeImageGet: (req, res) => res.send({ status: true, statusText: 'signed' }),
}));
jest.mock('../common-storage/common-wasabi.js', () => ({
    handleProfileGetForUser: (req, res) => res.send({ status: true, statusText: 'signed' }),
    handleTaskTypeImageGet: (req, res) => res.send({ status: true, statusText: 'signed' }),
}));
jest.mock('../Modules/storage/server/controller', () => new Proxy({}, {
    get: (_target, key) => (key === '__esModule' || key === 'then' ? undefined : (req, res) => res.status(200).send({ url: 'signed' })),
}));
jest.mock('../Modules/storage/wasabi/controller', () => new Proxy({}, {
    get: (_target, key) => (key === '__esModule' || key === 'then' ? undefined : (req, res) => res.send({ status: true, statusText: 'signed' })),
}));

const logger = require('../Config/loggerConfig');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { canReadProject } = require('../Config/projectAccess');
const { projectAccess } = require('../Config/contentAccess');
const { canSeeSprintById } = require('../Modules/Sprints/helpers/sprintVisibility');
const { resolveSheetScope } = require('../Modules/TimeSheet/helpers/timeScope');
const { ROLE_OWNER, ROLE_MEMBER } = require('../Config/roleTypes');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const OTHER_MEMBER = '6f0000000000000000000004';
const OPEN_PROJECT = '6f0000000000000000000a01';
const HIDDEN_PROJECT = '6f0000000000000000000a02';
const LOCKED_FILES_PROJECT = '6f0000000000000000000a03';
const SPRINT = '6f0000000000000000000e01';
const PRIVATE_SPRINT = '6f0000000000000000000e02';
const OPEN_TASK = '6f0000000000000000000b01';
const HIDDEN_TASK = '6f0000000000000000000b02';
const PRIVATE_SPRINT_TASK = '6f0000000000000000000b03';
const LOCKED_FILES_TASK = '6f0000000000000000000b04';
const FORM_TASK = '6f0000000000000000000b05';
const CLIP_TASK = '6f0000000000000000000b06';
const VOICE_TASK = '6f0000000000000000000b07';
const MISSING_TASK = '6f0000000000000000000bff';
const FORM = '6f0000000000000000000f01';
const HIDDEN_FORM = '6f0000000000000000000f02';
const SUBMISSION = '6f0000000000000000000d01';
const TRACKER = 'tr-1';

const key = {
    ownAttachment: `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/spec.pdf`,
    ownAttachmentThumbnail: `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/shot-200x200.png`,
    voiceNote: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/Attachment/voice-note.webm`,
    taskComment: `Project/${OPEN_PROJECT}/${SPRINT}/${OPEN_TASK}/Comments/photo.png`,
    projectComment: `Project/${OPEN_PROJECT}/Comments/photo.png`,
    projectAttachment: `Project/${OPEN_PROJECT}/ProjectAttachment/brief.pdf`,
    projectIcon: `Project/${OPEN_PROJECT}/Settings/ProjectIcon/icon.png`,
    channelImage: `chats/${OPEN_PROJECT}/channelImages/room.png`,
    ownScreenshot: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/TimeLog/${TRACKER}/1700000000.png`,
    ownScreenshotThumbnail: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/TimeLog/${TRACKER}/1700000000-150x150.png`,
    otherScreenshot: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/TimeLog/${TRACKER}/1700000999.png`,
    formUpload: `formAttachment/${FORM}/abcdef0123456789abcdef01.pdf`,
    hiddenFormUpload: `formAttachment/${HIDDEN_FORM}/abcdef0123456789abcdef02.pdf`,
    ownClip: `Clips/${CID}/${MEMBER}/clip-1.webm`,
    attachedClip: `Clips/${CID}/${OTHER_MEMBER}/clip-2.webm`,
    unattachedClip: `Clips/${CID}/${OTHER_MEMBER}/clip-3.webm`,
    clipAttachedBySomeoneElse: `Clips/${CID}/${OTHER_MEMBER}/clip-4.webm`,
    ownReminder: `Reminders/${CID}/${MEMBER}/note.pdf`,
    otherReminder: `Reminders/${CID}/${OTHER_MEMBER}/note.pdf`,
    taskTypeImage: 'setting/task_type/task.png',
    priorityImage: 'taskPriorities/high.png',
    companyLogo: 'companyIcon/logo-35x35.png',
    templateLogo: 'ProjectTemplate/template.png',
    hiddenTaskAttachment: `Project/${HIDDEN_PROJECT}/Sprint/${HIDDEN_TASK}/Attachment/secret.pdf`,
    hiddenProjectAttachment: `Project/${HIDDEN_PROJECT}/ProjectAttachment/secret.pdf`,
    hiddenProjectComment: `Project/${HIDDEN_PROJECT}/Comments/secret.png`,
    privateSprintAttachment: `Project/${OPEN_PROJECT}/Sprint/${PRIVATE_SPRINT_TASK}/Attachment/secret.pdf`,
    privateSprintComment: `Project/${OPEN_PROJECT}/${PRIVATE_SPRINT}/${PRIVATE_SPRINT_TASK}/Comments/secret.png`,
    lockedFilesAttachment: `Project/${LOCKED_FILES_PROJECT}/Sprint/${LOCKED_FILES_TASK}/Attachment/secret.pdf`,
    missingTaskAttachment: `Project/${OPEN_PROJECT}/Sprint/${MISSING_TASK}/Attachment/secret.pdf`,
    outsideLayouts: 'backups/company.zip',
    unknownProjectFolder: `Project/${OPEN_PROJECT}/Exports/all.csv`,
};

const ROLES = { [OWNER]: ROLE_OWNER, [MEMBER]: ROLE_MEMBER, [OTHER_MEMBER]: ROLE_MEMBER };

const flat = (value, path) => path.reduce((values, part) => values.flatMap((v) => {
    if (v === null || v === undefined) return [];
    const next = v[part];
    return Array.isArray(next) ? next : [next];
}), [value]);

const matches = (doc, query) => Object.entries(query).every(([field, want]) => {
    const values = flat(doc, field.split('.')).map(String);
    if (want && typeof want === 'object' && Array.isArray(want.$in)) return want.$in.some((w) => values.includes(String(w)));
    return values.includes(String(want));
});

mockDb.crud = async (db, { type, data }, method) => {
    const [query] = data;
    if (type === 'company_users') return { _id: 'seat' };
    const rows = (mockDb.rows[type] || []).filter((row) => matches(row, query));
    return method === 'find' ? rows : rows[0] || null;
};

beforeEach(() => {
    delete process.env.STORAGE_DOWNLOAD_SCOPE;
    logger.warn.mockClear();
    mockDb.rows = {
        tasks: [
            { _id: OPEN_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: key.ownAttachment }] },
            { _id: HIDDEN_TASK, ProjectID: HIDDEN_PROJECT, sprintId: SPRINT, attachments: [] },
            { _id: PRIVATE_SPRINT_TASK, ProjectID: OPEN_PROJECT, sprintId: PRIVATE_SPRINT, attachments: [] },
            { _id: LOCKED_FILES_TASK, ProjectID: LOCKED_FILES_PROJECT, sprintId: SPRINT, attachments: [] },
            { _id: FORM_TASK, ProjectID: HIDDEN_PROJECT, sprintId: SPRINT, origin: { kind: 'form', ref: SUBMISSION }, attachments: [{ url: key.formUpload }] },
            { _id: CLIP_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: key.attachedClip, userId: OTHER_MEMBER }, { url: key.clipAttachedBySomeoneElse, userId: MEMBER }] },
            { _id: VOICE_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: key.voiceNote }] },
        ],
        forms: [{ _id: FORM, ProjectID: OPEN_PROJECT, deletedStatusKey: 0 }, { _id: HIDDEN_FORM, ProjectID: HIDDEN_PROJECT, deletedStatusKey: 0 }],
        form_submissions: [{ _id: SUBMISSION, formId: FORM, taskId: FORM_TASK }],
        timesheets: [
            { _id: 'ts-1', Loggeduser: MEMBER, trackShots: [{ image: key.ownScreenshot }] },
            { _id: 'ts-2', Loggeduser: OTHER_MEMBER, trackShots: [{ image: key.otherScreenshot }] },
        ],
    };
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid] ?? null);
    evaluatePermission.mockImplementation(async (companyId, uid, permission, { projectId } = {}) => (projectId === LOCKED_FILES_PROJECT ? 0 : 1));
    canReadProject.mockImplementation(async (companyId, uid, projectId) => ({ allowed: ROLES[uid] === ROLE_OWNER || projectId !== HIDDEN_PROJECT }));
    projectAccess.mockImplementation(async (companyId, uid, projectId) => {
        const visible = ROLES[uid] === ROLE_OWNER || projectId !== HIDDEN_PROJECT;
        return { visible, canEdit: visible };
    });
    canSeeSprintById.mockImplementation(async (companyId, uid, sprintId) => String(sprintId) !== PRIVATE_SPRINT);
    resolveSheetScope.mockImplementation(async (companyId, uid) => ({ uid, everyone: ROLES[uid] === ROLE_OWNER, visible: null }));
});

const chainsOf = (modulePath, storageType) => {
    process.env.STORAGE_TYPE = storageType;
    const table = {};
    const app = {};
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
        app[method] = (routePath, ...handlers) => { table[`${method.toUpperCase()} ${routePath}`] = handlers.flat(); };
    }
    jest.isolateModules(() => require(modulePath).init(app));
    return table;
};

const SERVER = chainsOf('../Modules/storage/server/routes', 'server');
const WASABI = chainsOf('../Modules/storage/wasabi/routes', 'wasabi');

const run = (handlers, req) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.set = () => res;
    res.send = (body) => { resolve({ status: res.statusCode, body }); return res; };
    res.json = res.send;
    const step = (at) => {
        if (at >= handlers.length) return resolve({ status: 'fell through' });
        return Promise.resolve(handlers[at](req, res, () => step(at + 1))).catch(reject);
    };
    step(0);
});

const session = (uid) => ({ uid, aud: CID, headers: { companyid: CID } });

const SIGNING_ROUTES = {
    'GET /api/v1/generateSignedUrl/:bucketId': (uid, path) => run(SERVER['GET /api/v1/generateSignedUrl/:bucketId'], { ...session(uid), params: { bucketId: CID }, query: { filepath: path } }),
    'POST /api/v1/getTaskTypeImage (server)': (uid, path) => run(SERVER['POST /api/v1/getTaskTypeImage'], { ...session(uid), body: { companyId: CID, path } }),
    'POST /api/v1/wasabi/retriveObject': (uid, path) => run(WASABI['POST /api/v1/wasabi/retriveObject'], { ...session(uid), body: { companyId: CID, path } }),
    'POST /api/v1/admin/wasabi/retriveObject': (uid, path) => run(WASABI['POST /api/v1/admin/wasabi/retriveObject'], { ...session(uid), body: { companyId: CID, path } }),
    'POST /api/v1/getTaskTypeImage (wasabi)': (uid, path) => run(WASABI['POST /api/v1/getTaskTypeImage'], { ...session(uid), body: { companyId: CID, path } }),
};
const ROUTE_NAMES = Object.keys(SIGNING_ROUTES);

const signed = (out) => out.status === 200 && (out.body.url === 'signed' || out.body.statusText === 'signed');

const CALLERS = [
    ['task attachment in its own task folder', MEMBER, key.ownAttachment],
    ['task attachment thumbnail', MEMBER, key.ownAttachmentThumbnail],
    ['voice note filed in the sprint folder, listed by its task', MEMBER, key.voiceNote],
    ['task comment attachment', MEMBER, key.taskComment],
    ['project chat attachment', MEMBER, key.projectComment],
    ['project attachment', MEMBER, key.projectAttachment],
    ['project icon', MEMBER, key.projectIcon],
    ['chat channel image', MEMBER, key.channelImage],
    ['own tracker screenshot', MEMBER, key.ownScreenshot],
    ['own tracker screenshot thumbnail', MEMBER, key.ownScreenshotThumbnail],
    ["another person's tracker screenshot, for an owner", OWNER, key.otherScreenshot],
    ['form upload, for someone who manages the form', MEMBER, key.formUpload],
    ['form upload, through the task the form filed', OWNER, key.formUpload],
    ['own clip', MEMBER, key.ownClip],
    ["a colleague's clip attached to a task the caller may open", MEMBER, key.attachedClip],
    ['own reminder attachment', MEMBER, key.ownReminder],
    ['task type image', MEMBER, key.taskTypeImage],
    ['priority image', MEMBER, key.priorityImage],
    ['company logo thumbnail', MEMBER, key.companyLogo],
    ['template logo', MEMBER, key.templateLogo],
];

const REFUSED = [
    ['an attachment of a task in a project the caller cannot open', key.hiddenTaskAttachment],
    ['an attachment of a project the caller cannot open', key.hiddenProjectAttachment],
    ['a chat file of a project the caller cannot open', key.hiddenProjectComment],
    ['an attachment of a task in a private sprint', key.privateSprintAttachment],
    ['a comment file of a task in a private sprint', key.privateSprintComment],
    ["an attachment where the caller's role may not see attachments", key.lockedFilesAttachment],
    ['an attachment folder of no task', key.missingTaskAttachment],
    ["another person's tracker screenshot", key.otherScreenshot],
    ['an upload of a form in a project the caller cannot open', key.hiddenFormUpload],
    ["a colleague's clip that is on no task", key.unattachedClip],
    ["a colleague's clip on a task, attached by someone else", key.clipAttachedBySomeoneElse],
    ["a colleague's reminder attachment", key.otherReminder],
    ['a key outside every layout', key.outsideLayouts],
    ['a folder of a project the app never writes', key.unknownProjectFolder],
];

describe.each(ROUTE_NAMES)('%s', (routeName) => {
    const ask = SIGNING_ROUTES[routeName];

    it.each(CALLERS)('signs a %s', async (_label, uid, path) => {
        expect(signed(await ask(uid, path))).toBe(true);
    });

    it.each(REFUSED)('refuses %s', async (_label, path) => {
        const out = await ask(MEMBER, path);
        expect(out.status).toBe(404);
        expect(out.body).toEqual({ status: false, statusText: 'File not found', message: 'File not found', code: 'STORED_FILE_NOT_AVAILABLE' });
    });

    it('answers a hidden task and a task that does not exist alike', async () => {
        const hidden = await ask(MEMBER, key.hiddenTaskAttachment);
        const missing = await ask(MEMBER, key.missingTaskAttachment);
        expect(hidden).toEqual(missing);
    });
});

describe('report mode', () => {
    it('signs a refused key and logs its layout type only', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        const out = await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.hiddenTaskAttachment);
        expect(signed(out)).toBe(true);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [line] = logger.warn.mock.calls[0];
        expect(line).toContain('task_attachment');
        expect(line).not.toContain(HIDDEN_TASK);
        expect(line).not.toContain('secret');
    });

    it('is enforce for anything but report', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'off';
        expect((await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.hiddenTaskAttachment)).status).toBe(404);
    });
});

describe('the profile bucket on server storage', () => {
    it('is still decided by the profile rule alone', async () => {
        const avatar = `${MEMBER}_17_photo.png`;
        mockDb.rows.users = [{ _id: MEMBER, AssignCompany: [CID] }];
        const out = await run(SERVER['GET /api/v1/generateSignedUrl/:bucketId'], { ...session(MEMBER), params: { bucketId: 'USER_PROFILES' }, query: { filepath: avatar } });
        expect(signed(out)).toBe(true);
    });
});
