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
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ canSeeSprintById: jest.fn(), hiddenSprintIds: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
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
const { canSeeSprintById, hiddenSprintIds } = require('../Modules/Sprints/helpers/sprintVisibility');
const { visibleProjectIds } = require('../Modules/Agents/scope');
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

const matchValue = (values, want) => {
    const have = values.map(String);
    if (want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).some((op) => op.startsWith('$'))) {
        return Object.entries(want).every(([op, arg]) => {
            if (op === '$in') return arg.some((w) => have.includes(String(w)));
            if (op === '$nin') return !arg.some((w) => have.includes(String(w)));
            if (op === '$ne') return !have.includes(String(arg));
            throw new Error(`unsupported ${op}`);
        });
    }
    return have.includes(String(want));
};

const matches = (doc, query) => Object.entries(query).every(([field, want]) => {
    if (field === '$or') return want.some((q) => matches(doc, q));
    if (field === '$and') return want.every((q) => matches(doc, q));
    const values = flat(doc, field.split('.'));
    if (want && typeof want === 'object' && want.$elemMatch) return values.some((item) => item && typeof item === 'object' && matches(item, want.$elemMatch));
    return matchValue(values, want);
});

mockDb.crud = async (db, { type, data }, method) => {
    const [query] = data;
    if (type === 'company_users') return { _id: 'seat' };
    const rows = (mockDb.rows[type] || []).filter((row) => matches(row, query));
    const limit = data[2] && data[2].limit;
    if (method === 'find') return limit ? rows.slice(0, limit) : rows;
    return rows[0] || null;
};

beforeEach(() => {
    process.env.STORAGE_DOWNLOAD_SCOPE = 'enforce';
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
    canSeeSprintById.mockImplementation(async (companyId, uid, sprintId) => {
        const sprint = (mockDb.rows.sprints || []).find((row) => String(row._id) === String(sprintId));
        if (sprint) return sprint.private !== true || (sprint.AssigneeUserId || []).includes(uid);
        return String(sprintId) !== PRIVATE_SPRINT;
    });
    visibleProjectIds.mockImplementation(async (companyId, uid) => (ROLES[uid] === ROLE_OWNER ? [OPEN_PROJECT, HIDDEN_PROJECT, LOCKED_FILES_PROJECT] : [OPEN_PROJECT, LOCKED_FILES_PROJECT]));
    hiddenSprintIds.mockImplementation(async () => [PRIVATE_SPRINT]);
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
    it('is the default', async () => {
        delete process.env.STORAGE_DOWNLOAD_SCOPE;
        expect(signed(await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.hiddenTaskAttachment))).toBe(true);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('logs the reason category beside the layout type', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.outsideLayouts);
        await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.missingTaskAttachment);
        const [unknown] = logger.warn.mock.calls[0];
        const [missing] = logger.warn.mock.calls[1];
        expect(unknown).toMatch(/layout: unknown\b/);
        expect(missing).toMatch(/layout: task_attachment, reason: not_found/);
        expect(missing).not.toContain(MISSING_TASK);
    });

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

    it('refuses only when set to enforce', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'ENFORCE';
        expect((await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.hiddenTaskAttachment)).status).toBe(404);
        process.env.STORAGE_DOWNLOAD_SCOPE = 'off';
        expect(signed(await SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'](MEMBER, key.hiddenTaskAttachment))).toBe(true);
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

const CHAT_PROJECT = '6f0000000000000000000c0a';
const DM_PROJECT = '6f0000000000000000000c0b';
const PUBLIC_CHANNEL = '6f0000000000000000000e11';
const PRIVATE_CHANNEL = '6f0000000000000000000e12';
const PROJECT_CHANNEL = '6f0000000000000000000e13';
const HIDDEN_PROJECT_CHANNEL = '6f0000000000000000000e14';
const DM_SPRINT = '6f0000000000000000000e15';
const DM_TASK = '6f0000000000000000000b21';
const OTHER_PROJECT = '6f0000000000000000000a09';
const OTHER_COMPANY = '6f00000000000000000000c2';

const channelKey = (projectId, channelId) => `Project/${projectId}/${channelId}/default/Comments/room.png`;
const dmKey = `Project/${DM_PROJECT}/${DM_SPRINT}/${DM_TASK}/Comments/photo.png`;

const withChats = () => {
    mockDb.rows.main_chats = [{ _id: CHAT_PROJECT, default: false }, { _id: DM_PROJECT, default: true }];
    mockDb.rows.sprints = [
        { _id: PUBLIC_CHANNEL, projectId: CHAT_PROJECT, private: false, AssigneeUserId: [] },
        { _id: PRIVATE_CHANNEL, projectId: CHAT_PROJECT, private: true, AssigneeUserId: [MEMBER] },
        { _id: PROJECT_CHANNEL, projectId: OPEN_PROJECT, private: false, AssigneeUserId: [] },
        { _id: HIDDEN_PROJECT_CHANNEL, projectId: HIDDEN_PROJECT, private: false, AssigneeUserId: [] },
    ];
    mockDb.rows.tasks.push({ _id: DM_TASK, ProjectID: DM_PROJECT, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [MEMBER, OWNER], attachments: [] });
};

describe.each(ROUTE_NAMES)('%s, chat files', (routeName) => {
    const ask = SIGNING_ROUTES[routeName];
    beforeEach(withChats);

    it.each([
        ['a public channel file, for any member', OTHER_MEMBER, channelKey(CHAT_PROJECT, PUBLIC_CHANNEL)],
        ['a private channel file, for a channel member', MEMBER, channelKey(CHAT_PROJECT, PRIVATE_CHANNEL)],
        ['a channel file in a project the caller can open', MEMBER, channelKey(OPEN_PROJECT, PROJECT_CHANNEL)],
        ['a direct-message file, for a participant', MEMBER, dmKey],
    ])('signs %s', async (_label, uid, path) => {
        expect(signed(await ask(uid, path))).toBe(true);
    });

    it.each([
        ['a private channel file, for someone not in the channel', OTHER_MEMBER, channelKey(CHAT_PROJECT, PRIVATE_CHANNEL)],
        ['a private channel file, for an owner not in the channel', OWNER, channelKey(CHAT_PROJECT, PRIVATE_CHANNEL)],
        ['a channel file in a project the caller cannot open', MEMBER, channelKey(HIDDEN_PROJECT, HIDDEN_PROJECT_CHANNEL)],
        ['a channel named under another project', OTHER_MEMBER, channelKey(OPEN_PROJECT, PUBLIC_CHANNEL)],
        ['a channel that does not exist', MEMBER, channelKey(CHAT_PROJECT, '6f0000000000000000000eff')],
        ['a direct-message file, for someone outside the conversation', OTHER_MEMBER, dmKey],
    ])('refuses %s', async (_label, uid, path) => {
        expect((await ask(uid, path)).status).toBe(404);
    });
});

describe.each(ROUTE_NAMES)('%s, files a task lists outside its own folder', (routeName) => {
    const ask = SIGNING_ROUTES[routeName];

    it('signs a voice note whose task moved to another sprint, then another project', async () => {
        const task = mockDb.rows.tasks.find((row) => row._id === VOICE_TASK);
        task.sprintId = '6f0000000000000000000e09';
        expect(signed(await ask(MEMBER, key.voiceNote))).toBe(true);
        task.ProjectID = OTHER_PROJECT;
        visibleProjectIds.mockImplementation(async () => [OPEN_PROJECT, OTHER_PROJECT]);
        canReadProject.mockImplementation(async () => ({ allowed: true }));
        expect(signed(await ask(MEMBER, key.voiceNote))).toBe(true);
    });

    it('refuses a voice note whose only listing task the caller cannot open', async () => {
        mockDb.rows.tasks.find((row) => row._id === VOICE_TASK).ProjectID = HIDDEN_PROJECT;
        expect((await ask(MEMBER, key.voiceNote)).status).toBe(404);
    });

    it('signs a key listed by many tasks the caller cannot open and one they can', async () => {
        const shared = `Clips/${CID}/${OTHER_MEMBER}/shared.webm`;
        for (let i = 0; i < 25; i += 1) {
            mockDb.rows.tasks.unshift({ _id: `6f00000000000000000001${String(i).padStart(2, '0')}`, ProjectID: HIDDEN_PROJECT, sprintId: SPRINT, attachments: [{ url: shared, userId: OTHER_MEMBER }] });
        }
        mockDb.rows.tasks.push({ _id: '6f0000000000000000000199', ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: shared, userId: OTHER_MEMBER }] });
        expect(signed(await ask(MEMBER, shared))).toBe(true);
    });

    it('signs a thumbnail of a form upload', async () => {
        expect(signed(await ask(MEMBER, `formAttachment/${FORM}/abcdef0123456789abcdef01-150x150.png`))).toBe(true);
        mockDb.rows.tasks.find((row) => row._id === FORM_TASK).attachments = [{ url: `formAttachment/${FORM}/abcdef0123456789abcdef03.png` }];
        projectAccess.mockImplementation(async () => ({ visible: true, canEdit: false }));
        expect(signed(await ask(OWNER, `formAttachment/${FORM}/abcdef0123456789abcdef03-150x150.png`))).toBe(true);
    });

    it('lets owners and admins read past a private sprint', async () => {
        expect(signed(await ask(OWNER, key.privateSprintAttachment))).toBe(true);
        expect(signed(await ask(OWNER, key.privateSprintComment))).toBe(true);
    });

    it('refuses a clip filed under another company even when a task here lists it', async () => {
        const foreignClip = `Clips/${OTHER_COMPANY}/${OTHER_MEMBER}/clip-9.webm`;
        mockDb.rows.tasks.find((row) => row._id === OPEN_TASK).attachments.push({ url: foreignClip, userId: OTHER_MEMBER });
        expect((await ask(MEMBER, foreignClip)).status).toBe(404);
    });

    it.each([
        ['a clip filed under another company', `Clips/${OTHER_COMPANY}/${MEMBER}/clip-1.webm`],
        ['a reminder attachment filed under another company', `Reminders/${OTHER_COMPANY}/${MEMBER}/note.pdf`],
    ])('refuses %s', async (_label, path) => {
        expect((await ask(MEMBER, path)).status).toBe(404);
    });
});

describe('paths', () => {
    const wasabi = SIGNING_ROUTES['POST /api/v1/wasabi/retriveObject'];
    const server = SIGNING_ROUTES['GET /api/v1/generateSignedUrl/:bucketId'];
    const dotted = `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/notes...final.pdf`;

    it('signs a Wasabi key with dots inside a name', async () => {
        expect(signed(await wasabi(MEMBER, dotted))).toBe(true);
    });

    it.each([
        ['a .. segment', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/../../../${HIDDEN_PROJECT}/ProjectAttachment/secret.pdf`],
        ['a . segment', `Project/${OPEN_PROJECT}/./ProjectAttachment/brief.pdf`],
        ['an empty segment', `Project/${OPEN_PROJECT}//ProjectAttachment/brief.pdf`],
        ['an absolute key', `/Project/${OPEN_PROJECT}/ProjectAttachment/brief.pdf`],
        ['a .. name in a task folder the caller may open', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/..`],
        ['a . name in a project folder the caller may open', `Project/${OPEN_PROJECT}/ProjectAttachment/.`],
    ])('refuses a Wasabi key with %s', async (_label, path) => {
        expect((await wasabi(OWNER, path)).status).toBe(404);
    });

    it('keeps the stricter rule for server storage', async () => {
        expect(signed(await server(MEMBER, dotted))).toBe(false);
    });
});
