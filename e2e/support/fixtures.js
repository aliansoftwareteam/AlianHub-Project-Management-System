const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('./api');
const { STATE_DIR, resolveMongoUrl } = require('./env');

const PASSWORD = 'E2e-Passw0rd!';
const STATE_FILE = path.join(STATE_DIR, 'run.json');
const COMPANY_NAME = 'E2E Workspace';
const NAV_PREFERENCES = '/api/v2/users/nav-preferences';

/* roleType values from utils/data.js importCompanyRoles. Guest is the most restricted. */
const ROLES = {
    owner: { roleType: 1, firstName: 'Olivia', lastName: 'Owner' },
    admin: { roleType: 2, firstName: 'Ada', lastName: 'Admin' },
    member: { roleType: 3, firstName: 'Max', lastName: 'Member' },
    guest: { roleType: 0, firstName: 'Gus', lastName: 'Guest' },
};
const ROLE_NAMES = Object.keys(ROLES);

const uniqueSuffix = () => crypto.randomBytes(3).toString('hex');
const emailFor = (role, suffix = '') => `${role}${suffix ? `.${suffix}` : ''}@e2e.alianhub.test`;

function assertOk(res, what) {
    const refused = res.status >= 400 || (res.body && typeof res.body === 'object' && res.body.status === false);
    if (refused) throw new Error(`${what} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 500)}`);
    return res.body;
}

async function login(baseURL, email, password = PASSWORD) {
    const res = await createApiClient({ baseURL }).post('/api/v2/auth/login', { email, password });
    const body = assertOk(res, `login as ${email}`);
    if (!body.accessToken) throw new Error(`login as ${email} returned no session: ${JSON.stringify(body)}`);
    return { uid: String(body.uid), accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function setupOwner(baseURL) {
    const { firstName, lastName } = ROLES.owner;
    const email = emailFor('owner');
    const res = await createApiClient({ baseURL }).post('/api/v2/setup/complete', {
        firstName, lastName, email, password: PASSWORD, companyName: COMPANY_NAME, sampleData: false,
    });
    const { data } = assertOk(res, 'setup wizard');
    return { role: 'owner', roleType: ROLES.owner.roleType, email, userId: String(data.userId), companyId: String(data.companyId) };
}

/* The stored invitation, with the link token the Members screen puts in the address it copies. */
async function sendInvitation({ ownerApi, companyId, role, email }) {
    const invite = await ownerApi.post('/api/v2/sendInvitationEmail', {
        email, companyId, companyName: COMPANY_NAME, role: ROLES[role].roleType, designation: 0,
    });
    const inviteRow = invite.body && invite.body.data;
    if (invite.status !== 200 || !inviteRow || !inviteRow._id) {
        throw new Error(`invite ${email} failed (${invite.status}): ${JSON.stringify(invite.body).slice(0, 500)}`);
    }
    return inviteRow;
}

const invitationPath = (companyId, inviteRow) => `/#/invitation?companyId=${companyId}-${inviteRow._id}&token=${encodeURIComponent(inviteRow.linkId)}`;

/* The link mailed to an invited address that already has an account (Modules/Auth/controller/sendInvitation.js). */
const mailedInvitationPath = ({ userId, companyId, invitation }) => {
    const blob = Buffer.from(`userId=${userId}&companyId=${companyId}&docId=${invitation._id}&linkId=${invitation.linkId}`).toString('base64');
    return `/#/verify-invitation?id=${encodeURIComponent(blob)}`;
};

async function inGlobalDatabase(read) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    try {
        return await read(client.db('global'));
    } finally {
        await client.close();
    }
}

/* The workspace's own row, which the rest of the app reads its name, plan and details from. */
const readCompanyRow = (companyId) => inGlobalDatabase((global) => global.collection('companies').findOne({ _id: new ObjectId(String(companyId)) }));

/* An account made outside any invitation. Mail is not delivered in the suite, so the address is marked
 * verified the way tests/integration/invitation-signed-in-accept.int.test.js does. */
async function registerVerifiedAccount(baseURL, { firstName, lastName, email }) {
    const created = assertOk(await createApiClient({ baseURL }).post('/api/v2/createUser', { firstName, lastName, email, password: PASSWORD }), `register ${email}`);
    const userId = String(created.statusText._id);
    await inGlobalDatabase((global) => global.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { isEmailVerified: true } }));
    return userId;
}

/* A workspace of the account's own, made the way the last sign-up step makes one. */
async function createWorkspace(baseURL, { email, name }) {
    const session = await login(baseURL, email);
    const made = assertOk(await createApiClient({ baseURL, accessToken: session.accessToken }).post('/api/v2/company/create', {
        companyName: name, teamSize: '2-15', teamFocus: '', seedSampleProject: false, logtimeDays: 8, eventId: `ev_${uniqueSuffix()}`,
    }), `workspace for ${email}`);
    return String(made.companyId);
}

/* Invite acceptance without mail, through the same calls the /invitation page makes
 * (frontend/src/views/Authentication/Invitation/Invitation.vue): the owner sends the
 * invite, which stores the company_users row even when the mail cannot be delivered and
 * returns it; the invitee registers with isInvitation, which marks the email verified;
 * then, signed in as the invitee, the row is linked and activated (status 2). */
async function inviteMember({ baseURL, ownerApi, companyId, role, email, firstName, lastName, navMode = 'full' }) {
    const { roleType } = ROLES[role];
    const inviteRow = await sendInvitation({ ownerApi, companyId, role, email });

    const anon = createApiClient({ baseURL });
    const created = await anon.post('/api/v2/createUser', {
        firstName, lastName, email, password: PASSWORD, isInvitation: true, assignCompany: companyId,
        memberId: String(inviteRow._id), linkId: inviteRow.linkId,
    });
    const user = assertOk(created, `register ${email}`).statusText;
    const userId = String(user._id);

    const session = await login(baseURL, email);
    const api = createApiClient({ baseURL, accessToken: session.accessToken, companyId });
    assertOk(await api.put('/api/v1/root-members', { id: inviteRow._id, data: { userId, status: 2 }, companyId, linkId: inviteRow.linkId }), `accept invite for ${email}`);
    assertOk(await api.post('/api/v1/importSettingsNotification', { companyId, userId }), `notification settings for ${email}`);
    assertOk(await api.post('/api/v1/removeUserNotification', { companyId, userId, type: 'Add' }), `notification counter for ${email}`);
    // A new account starts in Simple, with five places on the rail. The suite walks the whole app, so its
    // people get the full rail unless a spec asks for the newcomer's (navMode: null).
    if (navMode) assertOk(await api.put(NAV_PREFERENCES, { mode: navMode }), `${navMode} rail for ${email}`);

    return { role, roleType, email, userId, companyUserId: String(inviteRow._id) };
}

async function createProject(api, { name, code, assigneeIds, createdBy, isPrivate = false, apps = [] }) {
    const suffix = uniqueSuffix();
    const res = await api.post('/api/v1/createproject', {
        AssigneeUserId: assigneeIds,
        ProjectName: name || `E2E Project ${suffix}`,
        CompanyId: api.companyId,
        ProjectCode: code || `E${suffix.toUpperCase()}`,
        ProjectType: 'Fix',
        LeadUserId: [],
        markAsStar: false,
        sprintsObj: {},
        sprintsfolders: {},
        DueDate: '',
        proposalId: '',
        skills: [],
        source: 'other',
        projectIcon: { type: 'color', data: '#6473e8' },
        TemplateName: '',
        TemplateId: 'blank',
        useTemplateProj: 'category',
        isPrivateSpace: isPrivate,
        TaskTypeTemplateId: '',
        statusType: 'active',
        lastTaskId: 0,
        ProjectRequiredDefaultComponent: 'ProjectListView',
        ProjectCurrency: {},
        projectCreatedBy: createdBy,
        isGlobalPermission: true,
        customFiedlsValue: [],
        includeSampleTasks: false,
        sampleFocus: '',
        apps,
    });
    return assertOk(res, `create project ${name}`).data;
}

async function listSprints(api, projectId) {
    const res = await api.get(`/api/v1/project/sprintFolder/${projectId}`, { query: { collection: 'sprints' } });
    if (res.status !== 200) throw new Error(`list sprints for ${projectId} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 500)}`);
    return Array.isArray(res.body) ? res.body : (res.body && res.body.data) || [];
}

async function listFolders(api, projectId) {
    const res = await api.get(`/api/v1/project/sprintFolder/${projectId}`, { query: { collection: 'folders' } });
    if (res.status !== 200) throw new Error(`list folders for ${projectId} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 500)}`);
    return Array.isArray(res.body) ? res.body : (res.body && res.body.data) || [];
}

const actingUser = (user) => ({ id: user.uid || user.userId, Employee_Name: `${ROLES[user.role]?.firstName || ''} ${ROLES[user.role]?.lastName || ''}`.trim() });

/* Same payloads the "New list" and "New folder" forms send. */
async function createFolder(api, { project, name, user, parentFolderId }) {
    const res = await api.post('/api/v1/folder', {
        companyId: api.companyId, projectId: project._id, folderName: name, userData: actingUser(user), projectName: project.ProjectName, mainChat: true,
        ...(parentFolderId ? { parentFolderId } : {}),
    });
    const body = assertOk(res, `create folder ${name}`);
    return { _id: String(body.data._id), name };
}

async function createList(api, { project, name, user, folder }) {
    const res = await api.post('/api/v1/sprint', {
        companyId: api.companyId, projectId: project._id, sprintName: name, userData: actingUser(user), projectName: project.ProjectName,
        folder: folder ? { folderId: folder._id, folderName: folder.name } : {}, private: false,
    });
    const body = assertOk(res, `create list ${name}`);
    return { _id: String(body.data._id), name };
}

/* POST /createproject answers before it adds the default "List" sprint, so a
 * task created straight after a project can find no sprint yet. */
async function firstSprint(api, projectId, { timeoutMs = 15000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const [sprint] = await listSprints(api, projectId);
        if (sprint || Date.now() > deadline) return sprint;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

/* Same payload the create-task forms send (see ConvertNoteToTask.vue). */
async function createTask(api, { project, name, user, companyOwnerId, assigneeIds = [], sprint: inSprint }) {
    const sprint = inSprint || await firstSprint(api, project._id);
    if (!sprint) throw new Error(`project ${project._id} has no sprint to hold a task`);
    const sprintId = String(sprint._id || sprint.id);
    const status = project.taskStatusData.find((x) => x.type === 'default_active');
    const taskType = project.taskTypeCounts[0];
    const res = await api.post('/api/v2/tasks', {
        data: {
            TaskName: name || `E2E Task ${uniqueSuffix()}`,
            TaskKey: '--',
            AssigneeUserId: assigneeIds.map(String),
            watchers: [user.userId],
            DueDate: '',
            dueDateDeadLine: [],
            TaskType: taskType.value,
            TaskTypeKey: taskType.key,
            ParentTaskId: '',
            ProjectID: project._id,
            CompanyId: api.companyId,
            status: { text: status.name, key: status.key, value: status.value, type: status.type },
            statusKey: status.key,
            statusType: status.type,
            isParentTask: true,
            Task_Leader: user.userId,
            sprintArray: { id: sprintId, name: sprint.name, value: sprint.value || sprint.name },
            Task_Priority: 'MEDIUM',
            deletedStatusKey: 0,
            sprintId,
        },
        user: { id: user.userId, Employee_Name: `${ROLES[user.role]?.firstName || ''} ${ROLES[user.role]?.lastName || ''}`.trim(), companyOwnerId },
        projectData: { _id: project._id, CompanyId: api.companyId, lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode },
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: status.key },
    });
    const body = assertOk(res, `create task in ${project.ProjectName}`);
    return { _id: String(body.id), name: res.body && name, projectId: String(project._id), sprintId };
}

async function readTask(api, taskId) {
    const res = await api.get(`/api/v1/task/${taskId}`);
    return (res.body && (res.body.data || res.body)) || {};
}

async function findTasksByName(api, projectId, name) {
    const res = await api.post('/api/v1/task/find', {
        findQuery: { $match: { $or: [{ objId: { ProjectID: projectId } }, { ProjectID: projectId }], TaskName: name, deletedStatusKey: 0 } },
    });
    return Array.isArray(res.body) ? res.body : [];
}

const pickProject = (project) => ({ _id: String(project._id), name: project.ProjectName, code: project.ProjectCode, isPrivate: Boolean(project.isPrivateSpace) });

async function createFixtures(baseURL) {
    const owner = await setupOwner(baseURL);
    const { companyId } = owner;
    const ownerSession = await login(baseURL, owner.email);
    const ownerApi = createApiClient({ baseURL, accessToken: ownerSession.accessToken, companyId });
    assertOk(await ownerApi.put(NAV_PREFERENCES, { mode: 'full' }), 'full rail for the owner');

    const users = { owner };
    for (const role of ROLE_NAMES.filter((name) => name !== 'owner')) {
        const { firstName, lastName } = ROLES[role];
        users[role] = await inviteMember({ baseURL, ownerApi, companyId, role, email: emailFor(role), firstName, lastName });
    }

    const everyone = ROLE_NAMES.map((role) => users[role].userId);
    const shared = await createProject(ownerApi, { name: 'E2E Shared Project', code: 'SHARED', assigneeIds: everyone, createdBy: owner.userId });
    const restricted = await createProject(ownerApi, { name: 'E2E Owner Only', code: 'OWNER', assigneeIds: [owner.userId], createdBy: owner.userId, isPrivate: true });

    const tasks = [];
    for (const name of ['E2E Task One', 'E2E Task Two', 'E2E Task Three']) {
        tasks.push(await createTask(ownerApi, { project: shared, name, user: owner, companyOwnerId: owner.userId }));
    }

    return {
        baseURL,
        companyId,
        companyName: COMPANY_NAME,
        password: PASSWORD,
        users,
        projects: { shared: pickProject(shared), restricted: pickProject(restricted) },
        tasks,
    };
}

function writeState(state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readState() {
    const file = process.env.E2E_STATE_FILE || STATE_FILE;
    if (!fs.existsSync(file)) {
        throw new Error(`No harness state at ${file}. Run the suite through \`npm run test:integration\` or \`npm run e2e\`.`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function loginAs(role, { state = readState() } = {}) {
    const user = state.users[role];
    if (!user) throw new Error(`Unknown role "${role}". Known roles: ${Object.keys(state.users).join(', ')}`);
    const session = await login(state.baseURL, user.email, state.password);
    return {
        ...user,
        ...session,
        companyId: state.companyId,
        api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId }),
    };
}

const storageStatePath = (role) => path.join(STATE_DIR, 'auth', `${role}.json`);

module.exports = {
    PASSWORD,
    ROLES,
    ROLE_NAMES,
    STATE_FILE,
    assertOk,
    createFixtures,
    createFolder,
    createList,
    createProject,
    createTask,
    createWorkspace,
    emailFor,
    findTasksByName,
    firstSprint,
    invitationPath,
    inviteMember,
    listFolders,
    listSprints,
    login,
    loginAs,
    mailedInvitationPath,
    readCompanyRow,
    readState,
    readTask,
    registerVerifiedAccount,
    sendInvitation,
    storageStatePath,
    uniqueSuffix,
    writeState,
};
