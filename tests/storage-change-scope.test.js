const mockWorld = { rows: {} };

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async (uid, companyId) => mockWorld.isMember(uid, companyId)) }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn((db, query, method) => mockWorld.crud(db, query, method)) }));
jest.mock('../Config/permissionGuard', () => {
    const roles = jest.requireActual('../Config/roleTypes');
    return {
        ...roles,
        getRoleType: jest.fn(async (companyId, uid) => mockWorld.roleOf(uid)),
        evaluatePermission: jest.fn(async (companyId, uid, permission) => mockWorld.permissionOf(uid, permission)),
        isReadable: (permission) => permission !== null && permission !== undefined && permission !== 0,
        isWritable: (permission) => permission === true || permission === 1 || permission === 2,
        fineGrainedEnforced: () => true,
    };
});
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => mockWorld.contentAccess(uid, projectId)),
    isCompanyMember: jest.fn(async (companyId, uid) => mockWorld.roleOf(uid) !== null),
}));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    canSeeSprintById: jest.fn(async (companyId, uid, sprintId) => mockWorld.canSeeSprint(uid, sprintId)),
    hiddenSprintIds: jest.fn(async (companyId, uid) => mockWorld.hiddenSprints(uid)),
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async (companyId, uid) => mockWorld.visibleProjects(uid)) }));
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({
    SHEET_PERMISSION: { user: 'u', project: 'p', workload: 'w', tracker: 't' },
    resolveSheetScope: jest.fn(async (companyId, uid) => ({ uid })),
    scopedTimeMatch: (scope) => ({ Loggeduser: scope.uid }),
}));
jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: (req, res, next) => next() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleProfileGetForUser: jest.fn(), handleTaskTypeImageGet: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleProfileGetForUser: jest.fn(), handleTaskTypeImageGet: jest.fn() }));
jest.mock('axios', () => Object.assign(jest.fn(async () => ({ data: Buffer.from('cloud bytes') })), { create: jest.fn(() => ({})), get: jest.fn(), post: jest.fn() }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'https://signed.example/object') }));
jest.mock('@aws-sdk/client-s3', () => {
    const send = jest.fn(async () => ({}));
    const command = (name) => class { constructor(input) { this.name = name; this.input = input; } };
    return {
        __send: send,
        S3Client: class { send(cmd) { return send(cmd); } },
        GetObjectCommand: command('GetObject'),
        CreateBucketCommand: command('CreateBucket'),
        PutObjectCommand: command('PutObject'),
        DeleteObjectCommand: command('DeleteObject'),
        ListObjectsV2Command: command('ListObjectsV2'),
        CopyObjectCommand: command('CopyObject'),
        DeleteBucketCommand: command('DeleteBucket'),
        HeadObjectCommand: command('HeadObject'),
    };
});

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const { __send: s3Send } = require('@aws-sdk/client-s3');
const logger = require('../Config/loggerConfig');
const { ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, isPrivileged } = require('../Config/roleTypes');

const { RULES } = require('../Modules/storage/changeScope');
const cloud = require('../Modules/CloudStorage/controller');

const CID = crypto.randomBytes(12).toString('hex');
const OTHER_COMPANY = crypto.randomBytes(12).toString('hex');
const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');
const SERVER = 'server';
const WASABI = 'wasabi';
const ROLE_VIEWER = 4;

const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const OTHER_MEMBER = '6f0000000000000000000004';
const VIEWER = '6f0000000000000000000005';
const NO_FILES_MEMBER = '6f0000000000000000000006';

const OPEN_PROJECT = '6f0000000000000000000a01';
const PRIVATE_PROJECT = '6f0000000000000000000a02';
const PERSONAL_LIST = '6f0000000000000000000a03';
const NEW_PROJECT = '6f0000000000000000000a09';
const CHAT_SPACE = '6f0000000000000000000c01';
const DM_SPACE = '6f0000000000000000000c02';

const SPRINT = '6f0000000000000000000e01';
const PRIVATE_PROJECT_SPRINT = '6f0000000000000000000e02';
const PERSONAL_SPRINT = '6f0000000000000000000e03';
const PRIVATE_CHANNEL = '6f0000000000000000000e04';
const DM_SPRINT = '6f0000000000000000000e05';
const PRIVATE_SPRINT = '6f0000000000000000000e06';

const OPEN_TASK = '6f0000000000000000000b01';
const PRIVATE_TASK = '6f0000000000000000000b02';
const PERSONAL_TASK = '6f0000000000000000000b03';
const DM_TASK = '6f0000000000000000000b04';
const VOICE_TASK = '6f0000000000000000000b05';
const PRIVATE_SPRINT_TASK = '6f0000000000000000000b06';
const MISSING_TASK = '6f0000000000000000000bff';

const PROJECT_DOC = '6f0000000000000000000d01';
const PRIVATE_DOC = '6f0000000000000000000d02';
const HIDDEN_DOC = '6f0000000000000000000d03';

const key = {
    attachment: `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/spec.pdf`,
    voiceNote: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/Attachment/voice-note.webm`,
    privateAttachment: `Project/${PRIVATE_PROJECT}/Sprint/${PRIVATE_TASK}/Attachment/secret.pdf`,
    privateTaskUnderOpenProject: `Project/${OPEN_PROJECT}/Sprint/${PRIVATE_TASK}/Attachment/secret.pdf`,
    privateVoiceNote: `Project/${PRIVATE_PROJECT}/Sprint/${PRIVATE_PROJECT_SPRINT}/Attachment/secret.webm`,
    privateSprintAttachment: `Project/${OPEN_PROJECT}/Sprint/${PRIVATE_SPRINT_TASK}/Attachment/secret.pdf`,
    personalAttachment: `Project/${PERSONAL_LIST}/Sprint/${PERSONAL_TASK}/Attachment/diary.pdf`,
    missingTaskAttachment: `Project/${OPEN_PROJECT}/Sprint/${MISSING_TASK}/Attachment/gone.pdf`,
    ownComment: `Project/${OPEN_PROJECT}/${SPRINT}/${OPEN_TASK}/Comments/mine.png`,
    othersComment: `Project/${OPEN_PROJECT}/${SPRINT}/${OPEN_TASK}/Comments/theirs.png`,
    unlistedComment: `Project/${OPEN_PROJECT}/${SPRINT}/${OPEN_TASK}/Comments/unlisted.png`,
    privateComment: `Project/${PRIVATE_PROJECT}/${PRIVATE_PROJECT_SPRINT}/${PRIVATE_TASK}/Comments/secret.png`,
    projectComment: `Project/${OPEN_PROJECT}/Comments/room.png`,
    dmFile: `Project/${DM_SPACE}/${DM_SPRINT}/${DM_TASK}/Comments/photo.png`,
    channelFile: `Project/${CHAT_SPACE}/${PRIVATE_CHANNEL}/default/Comments/room.png`,
    projectAttachment: `Project/${OPEN_PROJECT}/ProjectAttachment/brief.pdf`,
    privateProjectAttachment: `Project/${PRIVATE_PROJECT}/ProjectAttachment/secret.pdf`,
    personalProjectAttachment: `Project/${PERSONAL_LIST}/ProjectAttachment/diary.pdf`,
    projectIcon: `Project/${OPEN_PROJECT}/Settings/ProjectIcon/icon.png`,
    privateProjectIcon: `Project/${PRIVATE_PROJECT}/Settings/ProjectIcon/icon.png`,
    newProjectIcon: `Project/${NEW_PROJECT}/Settings/ProjectIcon/icon.png`,
    channelImage: `chats/${OPEN_PROJECT}/channelImages/room.png`,
    chatSpaceChannelImage: `chats/${CHAT_SPACE}/channelImages/room.png`,
    docImage: `Pages/${PROJECT_DOC}/0a1b2c3d4e5f60718293a4b5.png`,
    privateDocImage: `Pages/${PRIVATE_DOC}/0a1b2c3d4e5f60718293a4b5.png`,
    hiddenDocImage: `Pages/${HIDDEN_DOC}/0a1b2c3d4e5f60718293a4b5.png`,
    ownClip: `Clips/${CID}/${MEMBER}/clip.webm`,
    othersClip: `Clips/${CID}/${OTHER_MEMBER}/clip.webm`,
    foreignClip: `Clips/${OTHER_COMPANY}/${MEMBER}/clip.webm`,
    ownReminder: `Reminders/${CID}/${MEMBER}/note.pdf`,
    othersReminder: `Reminders/${CID}/${OTHER_MEMBER}/note.pdf`,
    foreignReminder: `Reminders/${OTHER_COMPANY}/${MEMBER}/note.pdf`,
    screenshot: `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/TimeLog/tr-1/1700000000.png`,
    formUpload: 'formAttachment/6f0000000000000000000f01/abcdef0123456789abcdef01.pdf',
    companyLogo: 'companyIcon/logo.png',
    templateLogo: 'ProjectTemplate/template.png',
    taskTypeImage: 'setting/task_type/custom.png',
    priorityImage: 'taskPriorities/custom.png',
    outsideLayouts: 'backups/company.zip',
    unknownProjectFolder: `Project/${OPEN_PROJECT}/Exports/all.csv`,
};

const ROLES = { [OWNER]: ROLE_OWNER, [ADMIN]: ROLE_ADMIN, [MEMBER]: ROLE_MEMBER, [OTHER_MEMBER]: ROLE_MEMBER, [VIEWER]: ROLE_VIEWER, [NO_FILES_MEMBER]: ROLE_MEMBER };

const MEMBER_RULES = {
    'task.task_attachments': true,
    'task.task_create': true,
    'task.task_custom_field': true,
    'project.project_attachments': true,
    'project.project_create': true,
    'project.project_details': false,
    'project.project_sprint_create': true,
    'project.private_projects': 1,
    'chat.chat_channel': true,
    'chat.one_to_one_chat': true,
};

const flat = (value, parts) => parts.reduce((values, part) => values.flatMap((v) => {
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

const isAssigned = (row, uid) => (row.AssigneeUserId || []).includes(uid);

mockWorld.isMember = (uid, companyId) => companyId === CID && ROLES[uid] !== undefined;
mockWorld.roleOf = (uid) => ROLES[uid] ?? null;
mockWorld.permissionOf = (uid, permission) => {
    const role = mockWorld.roleOf(uid);
    if (role === null) return null;
    if (isPrivileged(role)) return true;
    if (role === ROLE_VIEWER) return false;
    if (uid === NO_FILES_MEMBER && permission === 'task.task_attachments') return null;
    return MEMBER_RULES[permission] ?? null;
};
mockWorld.visibleProjects = (uid) => mockWorld.rows.projects.filter((project) => {
    if (project.isPersonal) return project.personalOwner === uid;
    return isPrivileged(mockWorld.roleOf(uid)) || project.isPrivateSpace !== true || isAssigned(project, uid);
}).map((project) => project._id);
mockWorld.contentAccess = (uid, projectId) => {
    const visible = mockWorld.visibleProjects(uid).includes(String(projectId));
    return { visible, canEdit: visible && mockWorld.roleOf(uid) !== ROLE_VIEWER };
};
mockWorld.canSeeSprint = (uid, sprintId) => {
    const sprint = mockWorld.rows.sprints.find((row) => row._id === String(sprintId));
    return !sprint || sprint.private !== true || isAssigned(sprint, uid);
};
mockWorld.hiddenSprints = (uid) => mockWorld.rows.sprints.filter((row) => row.private === true && !isAssigned(row, uid)).map((row) => row._id);
mockWorld.crud = async (db, { type, data }, method) => {
    const [query] = data;
    if (type === 'buckets') return { id: query.id, rule: { isPrivate: true } };
    if (db !== CID) return method === 'find' ? [] : null;
    if (type === 'company_users') return ROLES[String(query.userId)] === undefined ? null : { _id: 'seat', roleType: ROLES[String(query.userId)] };
    const rows = (mockWorld.rows[type] || []).filter((row) => matches(row, query));
    const limit = data[2] && data[2].limit;
    if (method === 'find') return limit ? rows.slice(0, limit) : rows;
    return rows[0] || null;
};

const seedRows = () => ({
    projects: [
        { _id: OPEN_PROJECT, isPrivateSpace: false },
        { _id: PRIVATE_PROJECT, isPrivateSpace: true, AssigneeUserId: [OTHER_MEMBER] },
        { _id: PERSONAL_LIST, isPrivateSpace: true, isPersonal: true, personalOwner: OTHER_MEMBER, AssigneeUserId: [OTHER_MEMBER] },
    ],
    main_chats: [{ _id: CHAT_SPACE, default: false }, { _id: DM_SPACE, default: true }],
    sprints: [
        { _id: SPRINT, projectId: OPEN_PROJECT },
        { _id: PRIVATE_SPRINT, projectId: OPEN_PROJECT, private: true, AssigneeUserId: [OTHER_MEMBER] },
        { _id: PRIVATE_PROJECT_SPRINT, projectId: PRIVATE_PROJECT },
        { _id: PERSONAL_SPRINT, projectId: PERSONAL_LIST },
        { _id: PRIVATE_CHANNEL, projectId: CHAT_SPACE, private: true, AssigneeUserId: [MEMBER, OTHER_MEMBER] },
        { _id: DM_SPRINT, projectId: DM_SPACE },
    ],
    tasks: [
        { _id: OPEN_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: key.attachment }, { url: key.privateVoiceNote }] },
        { _id: VOICE_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, attachments: [{ url: key.voiceNote }] },
        { _id: PRIVATE_TASK, ProjectID: PRIVATE_PROJECT, sprintId: PRIVATE_PROJECT_SPRINT, attachments: [{ url: key.privateAttachment }] },
        { _id: PRIVATE_SPRINT_TASK, ProjectID: OPEN_PROJECT, sprintId: PRIVATE_SPRINT, attachments: [{ url: key.privateSprintAttachment }] },
        { _id: PERSONAL_TASK, ProjectID: PERSONAL_LIST, sprintId: PERSONAL_SPRINT, attachments: [{ url: key.personalAttachment }] },
        { _id: DM_TASK, ProjectID: DM_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [OTHER_MEMBER, MEMBER], attachments: [] },
    ],
    comments: [
        { _id: '6f0000000000000000000701', projectId: OPEN_PROJECT, sprintId: SPRINT, taskId: OPEN_TASK, userId: MEMBER, mediaURL: key.ownComment, isDeleted: true },
        { _id: '6f0000000000000000000702', projectId: OPEN_PROJECT, sprintId: SPRINT, taskId: OPEN_TASK, userId: OTHER_MEMBER, mediaURL: key.othersComment },
        { _id: '6f0000000000000000000703', projectId: OPEN_PROJECT, sprintId: SPRINT, taskId: OPEN_TASK, userId: MEMBER, mediaURL: key.privateComment },
        { _id: '6f0000000000000000000704', projectId: PRIVATE_PROJECT, sprintId: PRIVATE_PROJECT_SPRINT, taskId: PRIVATE_TASK, userId: OTHER_MEMBER, mediaURL: key.privateComment },
        { _id: '6f0000000000000000000705', projectId: OPEN_PROJECT, userId: MEMBER, mediaURL: key.projectComment },
        { _id: '6f0000000000000000000706', projectId: DM_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK, userId: OTHER_MEMBER, mediaURL: key.dmFile },
        { _id: '6f0000000000000000000707', projectId: CHAT_SPACE, sprintId: PRIVATE_CHANNEL, taskId: 'default', userId: MEMBER, mediaURL: key.channelFile },
    ],
    pages: [
        { _id: PROJECT_DOC, ProjectID: OPEN_PROJECT, visibility: 'project', createdBy: OTHER_MEMBER, deletedStatusKey: 0 },
        { _id: PRIVATE_DOC, ProjectID: OPEN_PROJECT, visibility: 'private', createdBy: OTHER_MEMBER, deletedStatusKey: 0 },
        { _id: HIDDEN_DOC, ProjectID: PRIVATE_PROJECT, visibility: 'project', createdBy: OTHER_MEMBER, deletedStatusKey: 0 },
    ],
    timesheets: [{ _id: 'ts-1', Loggeduser: MEMBER, trackShots: [{ image: key.screenshot }] }],
});

const listen = (app) => new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve({ listening, baseURL: `http://127.0.0.1:${listening.address().port}` }));
});

const appFor = (storage) => {
    process.env.STORAGE_TYPE = storage;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.uid = req.headers['x-uid'];
        req.aud = `${CID},${OTHER_COMPANY}`;
        next();
    });
    jest.isolateModules(() => require(`../Modules/storage/${storage}/routes`).init(app));
    app.use((err, _req, res, _next) => res.status(500).send({ status: false, statusText: err.message }));
    return listen(app);
};

const apps = {};

beforeAll(async () => {
    apps[SERVER] = await appFor(SERVER);
    apps[WASABI] = await appFor(WASABI);
});

afterAll(async () => {
    await Promise.all(Object.values(apps).map(({ listening }) => new Promise((resolve) => { listening.closeAllConnections(); listening.close(resolve); })));
    fs.rmSync(path.join(STORAGE_ROOT, CID), { recursive: true, force: true });
    fs.rmSync(path.join(STORAGE_ROOT, OTHER_COMPANY), { recursive: true, force: true });
});

beforeEach(() => {
    mockWorld.rows = seedRows();
    s3Send.mockClear();
    axios.mockClear();
    logger.warn.mockClear();
    fs.rmSync(path.join(STORAGE_ROOT, CID), { recursive: true, force: true });
});

const ORIGINAL = 'original bytes';
const UPLOADED = 'uploaded bytes';
const onDisk = (filePath, bucket = CID) => path.join(STORAGE_ROOT, bucket, filePath);
const stored = (filePath) => (fs.existsSync(onDisk(filePath)) ? fs.readFileSync(onDisk(filePath), 'utf8') : null);
const seed = (filePath) => {
    fs.mkdirSync(path.dirname(onDisk(filePath)), { recursive: true });
    fs.writeFileSync(onDisk(filePath), ORIGINAL);
};
const sent = (name) => s3Send.mock.calls.map(([command]) => command).filter((command) => command.name === name);

const answer = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

const REMOVE = {
    [SERVER]: async (uid, filePath, { bucket = CID, thumbnails } = {}) => {
        if (bucket === CID) seed(filePath);
        const query = new URLSearchParams({ filepath: filePath, ...(thumbnails ? { thubmkey: thumbnails } : {}) });
        const out = await answer(await fetch(`${apps[SERVER].baseURL}/api/v1/storage/removeFile/${bucket}?${query}`, { method: 'DELETE', headers: { 'x-uid': uid } }));
        return { ...out, removed: stored(filePath) === null };
    },
    [WASABI]: async (uid, filePath, { bucket = CID } = {}) => {
        const out = await answer(await fetch(`${apps[WASABI].baseURL}/api/v1/wasabi/deleteFile`, {
            method: 'POST',
            headers: { 'x-uid': uid, 'content-type': 'application/json' },
            body: JSON.stringify({ companyId: bucket, path: filePath }),
        }));
        return { ...out, removed: sent('DeleteObject').length > 0 };
    },
};

const multipart = (uid, filePath, extra = {}) => {
    const form = new FormData();
    form.append('companyId', CID);
    form.append('path', filePath);
    for (const [field, value] of Object.entries(extra)) form.append(field, value);
    form.append('file', new Blob([UPLOADED]), 'note.txt');
    return { method: 'POST', headers: { 'x-uid': uid }, body: form };
};

const json = (uid, body) => ({ method: 'POST', headers: { 'x-uid': uid, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const BASE64 = Buffer.from(UPLOADED).toString('base64');

const UPLOAD = {
    'POST /api/v1/storage/uploadFile': async (uid, filePath) => {
        const out = await answer(await fetch(`${apps[SERVER].baseURL}/api/v1/storage/uploadFile`, multipart(uid, filePath)));
        return { ...out, written: stored(filePath) === UPLOADED };
    },
    'POST /api/v1/storage/uploadFileBase64': async (uid, filePath) => {
        const out = await answer(await fetch(`${apps[SERVER].baseURL}/api/v1/storage/uploadFileBase64`, json(uid, { companyId: CID, path: filePath, base64String: BASE64 })));
        return { ...out, written: stored(filePath) === UPLOADED };
    },
    'POST /api/v1/wasabi/uploadFile': async (uid, filePath) => {
        const out = await answer(await fetch(`${apps[WASABI].baseURL}/api/v1/wasabi/uploadFile`, multipart(uid, filePath)));
        return { ...out, written: sent('PutObject').length > 0 };
    },
    'POST /api/v1/wasabi/uploadFile_64': async (uid, filePath) => {
        const out = await answer(await fetch(`${apps[WASABI].baseURL}/api/v1/wasabi/uploadFile_64`, json(uid, { companyId: CID, path: filePath, base64String: BASE64 })));
        return { ...out, written: sent('PutObject').length > 0 };
    },
};

const NOT_FOUND_BODY = { status: false, statusText: 'File not found', message: 'File not found', code: 'STORED_FILE_NOT_AVAILABLE' };

const REMOVED = [
    ['an attachment of a task the caller can open, with the attachments permission', MEMBER, key.attachment],
    ['a voice note in the sprint folder, listed by a task the caller can change', MEMBER, key.voiceNote],
    ['an attachment in a private sprint, for an owner', OWNER, key.privateSprintAttachment],
    ['an attachment in their own personal list', OTHER_MEMBER, key.personalAttachment],
    ['the file of their own comment, once the comment is deleted', MEMBER, key.ownComment],
    ["the file of someone's comment, for an admin who can open the task", ADMIN, key.othersComment],
    ['the file of their own project chat message', MEMBER, key.projectComment],
    ['the file of their own direct message', OTHER_MEMBER, key.dmFile],
    ['the file of their own message in a private channel', MEMBER, key.channelFile],
    ['a project attachment, with the project attachments permission', MEMBER, key.projectAttachment],
    ['a project icon, with a project permission', MEMBER, key.projectIcon],
    ['an image in a doc the caller can edit', MEMBER, key.docImage],
    ['an image in their own private doc', OTHER_MEMBER, key.privateDocImage],
    ['their own clip', MEMBER, key.ownClip],
    ['their own reminder attachment', MEMBER, key.ownReminder],
    ['the company logo, for an admin', ADMIN, key.companyLogo],
    ['a template image, for an owner', OWNER, key.templateLogo],
];

const NOT_FOUND = [
    ['an attachment in a private project the caller is not on', MEMBER, key.privateAttachment],
    ['a private task named under a project the caller can open', MEMBER, key.privateTaskUnderOpenProject],
    ["a voice note of a private project that the caller's own task claims", MEMBER, key.privateVoiceNote],
    ['an attachment in a private sprint the caller is not on', MEMBER, key.privateSprintAttachment],
    ["an attachment in another person's personal list", MEMBER, key.personalAttachment],
    ["an attachment in another person's personal list, for an owner", OWNER, key.personalAttachment],
    ["an attachment in another person's personal list, for an admin", ADMIN, key.personalAttachment],
    ["a project attachment of another person's personal list, for an owner", OWNER, key.personalProjectAttachment],
    ['an attachment where the role may not see attachments', NO_FILES_MEMBER, key.attachment],
    ['an attachment folder of no task', MEMBER, key.missingTaskAttachment],
    ['a direct-message file, for an owner outside the conversation', OWNER, key.dmFile],
    ['a direct-message file, for an admin outside the conversation', ADMIN, key.dmFile],
    ['a private channel file, for an owner outside the channel', OWNER, key.channelFile],
    ["a comment file of a private project that the caller's own comment claims", MEMBER, key.privateComment],
    ['a file in a comment folder that no comment lists', MEMBER, key.unlistedComment],
    ['a project attachment of a private project', MEMBER, key.privateProjectAttachment],
    ['a project icon of a private project', MEMBER, key.privateProjectIcon],
    ['an image in a doc of a private project', MEMBER, key.hiddenDocImage],
    ["an image in a colleague's private doc", MEMBER, key.privateDocImage],
    ["a colleague's clip", MEMBER, key.othersClip],
    ["a colleague's reminder attachment", MEMBER, key.othersReminder],
    ['a clip filed under another company', MEMBER, key.foreignClip],
    ['a reminder attachment filed under another company', MEMBER, key.foreignReminder],
    ['a key outside every layout', OWNER, key.outsideLayouts],
    ['a folder of a project the app never writes', OWNER, key.unknownProjectFolder],
];

const READ_ONLY = [
    ['an attachment, for a role that may only read attachments', VIEWER, key.attachment],
    ["the file of someone else's comment", MEMBER, key.othersComment],
    ["the file of someone else's direct message, for the other participant", MEMBER, key.dmFile],
    ['a project attachment, for a role that may only read the project', VIEWER, key.projectAttachment],
    ['a project icon, for a role that may only read the project', VIEWER, key.projectIcon],
    ['an image in a doc the caller can read but not edit', VIEWER, key.docImage],
    ['the company logo, for a member', MEMBER, key.companyLogo],
    ['a template image, for a member', MEMBER, key.templateLogo],
    ['a task type image, for a member', MEMBER, key.taskTypeImage],
    ['their own tracker screenshot', MEMBER, key.screenshot],
    ['a chat channel image', OWNER, key.channelImage],
];

describe.each([SERVER, WASABI])('removing a stored file on %s storage', (storage) => {
    const remove = REMOVE[storage];

    it.each(REMOVED)('removes %s', async (_label, uid, filePath) => {
        const out = await remove(uid, filePath);
        expect(out.status).toBe(200);
        expect(out.body.status).toBe(true);
        expect(out.removed).toBe(true);
    });

    it.each(NOT_FOUND)('answers 404 and keeps %s', async (_label, uid, filePath) => {
        const out = await remove(uid, filePath);
        expect(out.status).toBe(404);
        expect(out.body).toEqual(NOT_FOUND_BODY);
        expect(out.removed).toBe(false);
    });

    it.each(READ_ONLY)('answers 403 and keeps %s', async (_label, uid, filePath) => {
        const out = await remove(uid, filePath);
        expect(out.status).toBe(403);
        expect(out.body).toMatchObject({ status: false, code: 'STORED_FILE_READ_ONLY' });
        expect(out.body.message).toBe(out.body.statusText);
        expect(out.removed).toBe(false);
    });

    it('answers a hidden task and a task that does not exist alike', async () => {
        const hidden = await remove(MEMBER, key.privateAttachment);
        const missing = await remove(MEMBER, key.missingTaskAttachment);
        expect(hidden).toEqual(missing);
    });

    it("refuses another company's bucket", async () => {
        const out = await remove(MEMBER, key.attachment, { bucket: OTHER_COMPANY });
        expect(out.status).toBe(403);
        expect(sent('DeleteObject')).toEqual([]);
    });

    it('does not follow the download switch', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        try {
            const out = await remove(MEMBER, key.privateAttachment);
            expect(out.status).toBe(404);
            expect(out.removed).toBe(false);
        } finally {
            delete process.env.STORAGE_DOWNLOAD_SCOPE;
        }
    });

    it('logs a layout it does not recognise without the ids or the file name', async () => {
        await remove(OWNER, key.unknownProjectFolder);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [line] = logger.warn.mock.calls[0];
        expect(line).toMatch(/layout: unknown/);
        expect(line).toContain('Project/<id>/Exports/<name>');
        expect(line).not.toContain(OPEN_PROJECT);
        expect(line).not.toContain('all.csv');
    });
});

describe('removing a stored file, paths', () => {
    it.each([
        ['a .. segment', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/../../../${PRIVATE_PROJECT}/ProjectAttachment/secret.pdf`],
        ['a . segment', `Project/${OPEN_PROJECT}/./ProjectAttachment/brief.pdf`],
        ['an empty segment', `Project/${OPEN_PROJECT}//ProjectAttachment/brief.pdf`],
        ['an absolute key', `/Project/${OPEN_PROJECT}/ProjectAttachment/brief.pdf`],
        ['a .. name in a folder the caller may change', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/..`],
    ])('refuses a Wasabi key with %s', async (_label, filePath) => {
        const out = await REMOVE[WASABI](OWNER, filePath);
        expect([400, 404]).toContain(out.status);
        expect(out.body.status).toBe(false);
        expect(out.removed).toBe(false);
    });

    it.each([
        ['a .. segment', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/../../../${OTHER_COMPANY}/secret.pdf`],
        ['an absolute path', '/etc/hosts'],
    ])('refuses a server path with %s', async (_label, filePath) => {
        const out = await answer(await fetch(`${apps[SERVER].baseURL}/api/v1/storage/removeFile/${CID}?${new URLSearchParams({ filepath: filePath })}`, { method: 'DELETE', headers: { 'x-uid': OWNER } }));
        expect(out.status).toBe(400);
    });

    it('removes the thumbnails beside an attachment on server storage', async () => {
        const thumbnail = key.attachment.replace('spec.pdf', 'spec-200x200.pdf');
        seed(thumbnail);
        const out = await REMOVE[SERVER](MEMBER, key.attachment, { thumbnails: 'attachmentIcon' });
        expect(out.status).toBe(200);
        expect(out.removed).toBe(true);
    });

    it('still lets a person remove their own profile image on server storage', async () => {
        const avatar = `${MEMBER}_17_photo.png`;
        const file = path.join(STORAGE_ROOT, 'USER_PROFILES', avatar);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, ORIGINAL);
        try {
            const out = await answer(await fetch(`${apps[SERVER].baseURL}/api/v1/storage/removeFile/USER_PROFILES?${new URLSearchParams({ filepath: avatar })}`, { method: 'DELETE', headers: { 'x-uid': MEMBER } }));
            expect(out.status).toBe(200);
            expect(fs.existsSync(file)).toBe(false);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });
});

const UPLOADED_ROWS = [
    ['an attachment to a task the caller can open, with the attachments permission', MEMBER, `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/new.pdf`],
    ['a voice note into the folder of a sprint the caller can open', MEMBER, `Project/${OPEN_PROJECT}/Sprint/${SPRINT}/Attachment/new.webm`],
    ['an attachment to a task in their own personal list', OTHER_MEMBER, `Project/${PERSONAL_LIST}/Sprint/${PERSONAL_TASK}/Attachment/new.pdf`],
    ['a file for a comment on a task the caller can open', MEMBER, `Project/${OPEN_PROJECT}/${SPRINT}/${OPEN_TASK}/Comments/new.png`],
    ['a file for the project chat', MEMBER, `Project/${OPEN_PROJECT}/Comments/new.png`],
    ['a file for a direct message, for a participant', MEMBER, `Project/${DM_SPACE}/${DM_SPRINT}/${DM_TASK}/Comments/new.png`],
    ['a file for a private channel, for a channel member', MEMBER, `Project/${CHAT_SPACE}/${PRIVATE_CHANNEL}/default/Comments/new.png`],
    ['the first file of a new direct conversation', MEMBER, `Project/${DM_SPACE}/Comments/new.png`],
    ['a project attachment, with the project attachments permission', MEMBER, `Project/${OPEN_PROJECT}/ProjectAttachment/new.pdf`],
    ['a project icon, with a project permission', MEMBER, `Project/${OPEN_PROJECT}/Settings/ProjectIcon/new.png`],
    ['the icon of a project being created, with the create permission', MEMBER, key.newProjectIcon],
    ['a channel image in a project, with the list permission', MEMBER, `chats/${OPEN_PROJECT}/channelImages/new.png`],
    ['a channel image in the chat space, with the channel permission', MEMBER, `chats/${CHAT_SPACE}/channelImages/new.png`],
    ['their own clip', MEMBER, `Clips/${CID}/${MEMBER}/new.webm`],
    ['their own reminder attachment', MEMBER, `Reminders/${CID}/${MEMBER}/new.pdf`],
    ['the company logo, for an admin', ADMIN, 'companyIcon/new.png'],
    ['a template image, for an owner', OWNER, 'ProjectTemplate/new.png'],
    ['a priority image, for an admin', ADMIN, 'taskPriorities/new.png'],
    ['a task type image, for someone who may create projects', MEMBER, 'setting/task_type/new.png'],
];

const UPLOAD_NOT_FOUND = [
    ['an attachment into a private project the caller is not on', MEMBER, key.privateAttachment],
    ['an attachment to a private task named under a project the caller can open', MEMBER, key.privateTaskUnderOpenProject],
    ['a voice note into the sprint folder of a private project', MEMBER, key.privateVoiceNote],
    ["an attachment into another person's personal list", MEMBER, key.personalAttachment],
    ["an attachment into another person's personal list, for an owner", OWNER, key.personalAttachment],
    ['an attachment into the folder of no task and no sprint', MEMBER, key.missingTaskAttachment],
    ['a file into a direct message the caller is not in, for an owner', OWNER, key.dmFile],
    ['a file into a private channel the caller is not in, for an owner', OWNER, key.channelFile],
    ['a comment file into a private project', MEMBER, key.privateComment],
    ['a file into the chat space as if it were a project chat', MEMBER, `Project/${CHAT_SPACE}/Comments/new.png`],
    ['a project attachment into a private project', MEMBER, key.privateProjectAttachment],
    ['a project icon into a private project', MEMBER, key.privateProjectIcon],
    ["a file into a colleague's clip folder", MEMBER, key.othersClip],
    ["a file into a colleague's reminder folder", MEMBER, key.othersReminder],
    ['a clip filed under another company', MEMBER, key.foreignClip],
    ['a key outside every layout', OWNER, key.outsideLayouts],
    ['a folder of a project the app never writes', OWNER, key.unknownProjectFolder],
];

const UPLOAD_READ_ONLY = [
    ['an attachment, for a role that may only read attachments', VIEWER, key.attachment],
    ['a project attachment, for a role that may only read the project', VIEWER, key.projectAttachment],
    ['a project icon, for a role that may only read the project', VIEWER, key.projectIcon],
    ['the icon of a project that does not exist, without the create permission', VIEWER, key.newProjectIcon],
    ['the first file of a new direct conversation, for a role that may not start one', VIEWER, `Project/${DM_SPACE}/Comments/new.png`],
    ['the company logo, for a member', MEMBER, key.companyLogo],
    ['a template image, for a member', MEMBER, key.templateLogo],
    ['a priority image, for a member', MEMBER, key.priorityImage],
    ['a task type image, for a role that may not create projects', VIEWER, key.taskTypeImage],
    ['a doc image, which has its own upload route', MEMBER, key.docImage],
    ['a tracker screenshot, which has its own upload route', MEMBER, key.screenshot],
];

describe.each(Object.keys(UPLOAD))('%s', (routeName) => {
    const upload = UPLOAD[routeName];

    it.each(UPLOADED_ROWS)('stores %s', async (_label, uid, filePath) => {
        const out = await upload(uid, filePath);
        expect(out.status).toBe(200);
        expect(out.body.status).toBe(true);
        expect(out.written).toBe(true);
    });

    it.each(UPLOAD_NOT_FOUND)('answers 404 and writes nothing for %s', async (_label, uid, filePath) => {
        const out = await upload(uid, filePath);
        expect(out.status).toBe(404);
        expect(out.body).toMatchObject({ status: false, statusText: 'File not found' });
        expect(out.written).toBe(false);
    });

    it.each(UPLOAD_READ_ONLY)('answers 403 and writes nothing for %s', async (_label, uid, filePath) => {
        const out = await upload(uid, filePath);
        expect(out.status).toBe(403);
        expect(out.body.status).toBe(false);
        expect(out.written).toBe(false);
    });
});

describe('uploading over a stored file on server storage', () => {
    it.each(['POST /api/v1/storage/uploadFile', 'POST /api/v1/storage/uploadFileBase64'])('%s leaves a file the caller may not change as it was', async (routeName) => {
        seed(key.privateAttachment);
        const out = await UPLOAD[routeName](MEMBER, key.privateAttachment);
        expect(out.status).toBe(404);
        expect(stored(key.privateAttachment)).toBe(ORIGINAL);
    });
});

describe('importing a cloud file', () => {
    const importInto = async (uid, filePath) => {
        process.env.STORAGE_TYPE = SERVER;
        const answers = [];
        const res = { status: () => res, send: (body) => { answers.push(body); return res; } };
        await cloud.importFile({
            uid,
            aud: CID,
            headers: { companyid: CID },
            params: { provider: 'dropbox' },
            body: { fileId: 'file-1', filename: 'handover.pdf', path: filePath, downloadUrl: 'https://dl.dropboxusercontent.com/s/abc/handover.pdf' },
        }, res);
        return answers[0];
    };

    it('stores the copy in the folder of a task the caller may attach to', async () => {
        const filePath = `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/handover.pdf`;
        expect(await importInto(MEMBER, filePath)).toMatchObject({ status: true });
        expect(stored(filePath)).toBe('cloud bytes');
    });

    it.each([
        ['a private project the caller is not on', MEMBER, key.privateAttachment],
        ["another person's personal list, for an owner", OWNER, key.personalAttachment],
        ['a task where the role may only read attachments', VIEWER, key.attachment],
        ['a folder outside every layout', OWNER, key.outsideLayouts],
    ])('refuses %s before it downloads anything', async (_label, uid, filePath) => {
        seed(filePath);
        expect(await importInto(uid, filePath)).toMatchObject({ status: false });
        expect(axios).not.toHaveBeenCalled();
        expect(stored(filePath)).toBe(ORIGINAL);
    });
});

describe('a file stored in a custom field', () => {
    const FIELD = '6f0000000000000000000f11';
    const fieldFile = (projectId, taskId) => {
        const filePath = `Project/${projectId}/Sprint/${taskId}/Field/${FIELD}/contract.pdf`;
        return [[filePath, projectId, taskId, FIELD], filePath];
    };
    const ask = (action, uid, projectId, taskId) => {
        const [match, filePath] = fieldFile(projectId, taskId);
        return RULES.task_field_file[action]({ companyId: CID, uid, storage: WASABI }, match, filePath);
    };

    it.each(['remove', 'upload'])('%s is for whoever may open the task and change its custom fields', async (action) => {
        expect(await ask(action, MEMBER, OPEN_PROJECT, OPEN_TASK)).toBe(true);
        expect(await ask(action, VIEWER, OPEN_PROJECT, OPEN_TASK)).toBe('read_only');
        expect(await ask(action, MEMBER, PRIVATE_PROJECT, PRIVATE_TASK)).toBe('not_found');
        expect(await ask(action, OWNER, PERSONAL_LIST, PERSONAL_TASK)).toBe('not_found');
        expect(await ask(action, MEMBER, OPEN_PROJECT, MISSING_TASK)).toBe('not_found');
    });
});
