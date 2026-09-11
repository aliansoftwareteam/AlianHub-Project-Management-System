const fs = require('fs');
const os = require('os');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { localTargetProblem } = require('../scripts/demo/lib/guard');
const { seedDemoTeam } = require('../scripts/demo/lib/seed');
const { unseedDemoTeam } = require('../scripts/demo/lib/unseed');
const { issueSessionToken } = require('../scripts/demo/lib/session');
const { readAccounts, writeAccounts } = require('../scripts/demo/lib/accounts');
const { PEOPLE, TASKS, AGENTS } = require('../scripts/demo/lib/team');

const GLOBAL = dbCollections.GLOBAL;
const save = (db, type, data) => mockDb.crud(db, { type, data }, 'save');
const rows = (type) => mockDb.store[type] || [];
const counts = () => Object.fromEntries(Object.entries(mockDb.store).map(([type, list]) => [type, list.length]));

const fakeAdapter = () => ({
    createUser: jest.fn(async ({ companyId, person }) => {
        const user = await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: person.email, AssignCompany: [companyId], demo: true });
        await save(GLOBAL, dbCollections.USER_AUTH, { _id: user._id, email: person.email });
        return user._id;
    }),
    addMember: jest.fn(async ({ companyId, userId, email, roleType }) => {
        const member = await save(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId, userEmail: email, roleType, status: 2, demo: true });
        const counter = await save(companyId, dbCollections.USERID, { userId });
        const settings = await save(companyId, SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId });
        return { companyUserId: member._id, userIdCountId: counter._id, notificationSettingsId: settings._id };
    }),
    createProject: jest.fn(async ({ companyId, project, memberIds }) => {
        const saved = await save(companyId, SCHEMA_TYPE.PROJECTS, { ProjectName: project.name, AssigneeUserId: memberIds, demo: true });
        const list = await save(companyId, SCHEMA_TYPE.SPRINTS, { name: 'List', projectId: saved._id, demo: true });
        return { projectId: saved._id, listSprintId: list._id };
    }),
    createSprint: jest.fn(async ({ companyId, projectId, sprint }) => (await save(companyId, SCHEMA_TYPE.SPRINTS, {
        name: sprint.name, projectId, isScrum: true, state: 'planned', demo: true,
    }))._id),
    startSprint: jest.fn(async ({ companyId, sprintId }) => {
        await mockDb.crud(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: sprintId }, { $set: { state: 'active' } }] }, 'updateOne');
    }),
    createTask: jest.fn(async ({ companyId, project, task }) => (await save(companyId, SCHEMA_TYPE.TASKS, {
        TaskName: task.name, ProjectID: String(project._id), demo: true,
    }))._id),
    createAgent: jest.fn(async ({ companyId, projectId, agent }) => {
        const saved = await save(companyId, SCHEMA_TYPE.AGENTS, { name: agent.name, projectIds: [projectId], demo: true });
        const revision = await save(companyId, SCHEMA_TYPE.AGENT_REVISIONS, { agentId: saved._id, n: 1 });
        return { agentId: saved._id, revisionIds: [revision._id] };
    }),
    collectSideRecords: jest.fn(async ({ companyId, projectId }) => {
        const history = await save(companyId, SCHEMA_TYPE.HISTORY, { ProjectId: projectId });
        return { history: [history._id] };
    }),
    issueSession: jest.fn(async (userId) => {
        const session = await save(GLOBAL, dbCollections.SESSIONS, { userId });
        return { accessToken: 'header.payload.signature', sessionId: session._id };
    }),
});

const originalEnv = { ...process.env };
let accountsPath;
let companyId;
let adapter;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    mockDb.calls.length = 0;
    process.env.MONGODB_URL = 'mongodb://localhost:27017';
    process.env.NODE_ENV = 'test';
    accountsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-team-')), '.demo-accounts.local.json');
    companyId = mockDb.seed(SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: 'Local', userId: 'ownerid' })._id;
    mockDb.seed(SCHEMA_TYPE.SETTINGS, {
        name: 'roles',
        settings: [{ name: 'Guest', key: 0 }, { name: 'Owner', key: 1 }, { name: 'Admin', key: 2 }, { name: 'Member', key: 3 }],
    });
    adapter = fakeAdapter();
});

afterAll(() => {
    process.env = originalEnv;
});

describe('the demo scripts only run against a local database', () => {
    it.each([
        'mongodb://localhost:27017',
        'mongodb://127.0.0.1:27017/',
        'mongodb://dev:secret@127.0.0.1:27017/?authSource=admin',
        'mongodb://localhost:27017,127.0.0.1:27018',
    ])('accepts %s', (url) => {
        expect(localTargetProblem({ MONGODB_URL: url, NODE_ENV: 'development' })).toBeNull();
    });

    it.each([
        'mongodb://db.internal:27017',
        'mongodb+srv://cluster0.example.mongodb.net',
        'mongodb://localhost:27017,db.internal:27017',
        'mongodb://localhost.evil.com:27017',
        'mongodb://user@localhost:27017@evil.com',
        '',
    ])('refuses %p', (url) => {
        expect(localTargetProblem({ MONGODB_URL: url, NODE_ENV: 'development' })).toMatch(/MONGODB_URL/);
    });

    it('refuses production even on localhost, and has no --force', () => {
        expect(localTargetProblem({ MONGODB_URL: 'mongodb://localhost:27017', NODE_ENV: 'production' })).toMatch(/production/);
        expect(localTargetProblem({ MONGODB_URL: 'mongodb://localhost:27017', NODE_ENV: 'development' }, ['--force'])).toMatch(/--force/);
    });

    it.each([
        ['a remote database', { MONGODB_URL: 'mongodb://db.example.com:27017' }],
        ['production', { NODE_ENV: 'production' }],
    ])('seed, unseed and token refuse %s before reading anything', async (_, env) => {
        Object.assign(process.env, env);
        await expect(seedDemoTeam({ accountsPath, adapter })).rejects.toThrow(/Refusing to run/);
        await expect(unseedDemoTeam({ accountsPath })).rejects.toThrow(/Refusing to run/);
        await expect(issueSessionToken({ email: 'priya.frontend@demo.test', accountsPath, adapter })).rejects.toThrow(/Refusing to run/);
        expect(mockDb.calls).toHaveLength(0);
        expect(fs.existsSync(accountsPath)).toBe(false);
    });
});

describe('demo:seed', () => {
    it('creates the team with their roles, the sandbox, its sprint, tasks and agents', async () => {
        const report = await seedDemoTeam({ accountsPath, adapter });

        expect(report.created).toEqual({ users: 8, members: 8, projects: 1, sprints: 2, tasks: TASKS.length, agents: AGENTS.length });
        const roleOf = (email) => rows(SCHEMA_TYPE.COMPANY_USERS).find((m) => m.userEmail === email).roleType;
        expect(roleOf('rahul.manager@demo.test')).toBe(2);
        expect(roleOf('priya.frontend@demo.test')).toBe(3);
        expect(roleOf('kabir.intern@demo.test')).toBe(0);
        expect(rows(SCHEMA_TYPE.SPRINTS).find((s) => s.name === 'Sprint 1').state).toBe('active');
        expect(PEOPLE.every((person) => person.email.endsWith('@demo.test'))).toBe(true);

        expect(fs.statSync(accountsPath).mode & 0o777).toBe(0o600);
        const saved = readAccounts(accountsPath).companies[companyId];
        expect(saved.accounts).toHaveLength(8);
        expect(saved.accounts.every((account) => typeof account.password === 'string' && account.password.length >= 24)).toBe(true);
        expect(JSON.stringify(report)).not.toMatch(/password/i);
    });

    it('a second run creates nothing new', async () => {
        await seedDemoTeam({ accountsPath, adapter });
        const before = counts();
        const accountsBefore = readAccounts(accountsPath).companies[companyId].accounts;

        const again = await seedDemoTeam({ accountsPath, adapter });

        expect(again.created).toEqual({ users: 0, members: 0, projects: 0, sprints: 0, tasks: 0, agents: 0 });
        expect(counts()).toEqual(before);
        expect(readAccounts(accountsPath).companies[companyId].accounts).toEqual(accountsBefore);
        expect(adapter.createUser).toHaveBeenCalledTimes(8);
        expect(adapter.startSprint).toHaveBeenCalledTimes(1);
        expect(adapter.collectSideRecords).toHaveBeenCalledTimes(1);
    });

    it('refuses to guess when there is more than one company', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: 'Other' });
        await expect(seedDemoTeam({ accountsPath, adapter })).rejects.toThrow(/--company/);
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    it('leaves an existing account with a demo email alone and stops before the project', async () => {
        await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: 'sara.qa@demo.test' });
        await expect(seedDemoTeam({ accountsPath, adapter })).rejects.toThrow(/sara\.qa@demo\.test/);
        expect(rows(SCHEMA_TYPE.USERS).find((u) => u.Employee_Email === 'sara.qa@demo.test').demo).toBeUndefined();
        expect(adapter.createProject).not.toHaveBeenCalled();
    });
});

describe('demo:unseed', () => {
    it('removes what the seed created and nothing else, even from an edited manifest', async () => {
        await seedDemoTeam({ accountsPath, adapter });
        const realUser = await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: 'real@company.example' });
        const realProject = await save(companyId, SCHEMA_TYPE.PROJECTS, { ProjectName: 'Real work' });
        const sandbox = rows(SCHEMA_TYPE.PROJECTS).find((project) => project.demo);
        const qaTask = await save(companyId, SCHEMA_TYPE.TASKS, { TaskName: 'Filed by QA', ProjectID: sandbox._id });

        const accounts = readAccounts(accountsPath);
        const records = accounts.companies[companyId].records;
        records.users.push(realUser._id);
        records.userAuth.push(realUser._id);
        records.projects.push(realProject._id);
        records.tasks.push(qaTask._id);
        writeAccounts(accountsPath, accounts);

        const removed = (await unseedDemoTeam({ accountsPath }))[companyId];

        expect(removed).toMatchObject({
            users: 8, userAuth: 8, companyUsers: 8, userIdCounts: 8, notificationSettings: 8,
            projects: 1, sprints: 2, tasks: TASKS.length, agents: AGENTS.length, agentRevisions: AGENTS.length, history: 1,
        });
        expect(rows(SCHEMA_TYPE.USERS).map((u) => u._id)).toEqual([realUser._id]);
        expect(rows(SCHEMA_TYPE.PROJECTS).map((p) => p._id)).toEqual([realProject._id]);
        expect(rows(SCHEMA_TYPE.TASKS).map((t) => t._id)).toEqual([qaTask._id]);
        expect(rows(SCHEMA_TYPE.AGENTS)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.COMPANIES)).toHaveLength(1);
        expect(rows(SCHEMA_TYPE.SETTINGS)).toHaveLength(1);
        expect(fs.existsSync(accountsPath)).toBe(false);
    });
});

describe('demo:token', () => {
    it('refuses an email that is not in the credentials file, without touching the database', async () => {
        await seedDemoTeam({ accountsPath, adapter });
        await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: 'owner@local.test', AssignCompany: [companyId] });
        const callsBefore = mockDb.calls.length;

        await expect(issueSessionToken({ email: 'owner@local.test', accountsPath, adapter })).rejects.toThrow(/not a demo account/);
        await expect(issueSessionToken({ email: 'nobody@demo.test', accountsPath, adapter })).rejects.toThrow(/not a demo account/);
        await expect(issueSessionToken({ email: true, accountsPath, adapter })).rejects.toThrow(/--email/);

        expect(mockDb.calls).toHaveLength(callsBefore);
        expect(adapter.issueSession).not.toHaveBeenCalled();
    });

    it('refuses every email when no credentials file exists', async () => {
        await expect(issueSessionToken({ email: 'priya.frontend@demo.test', accountsPath, adapter })).rejects.toThrow(/not a demo account/);
        expect(adapter.issueSession).not.toHaveBeenCalled();
    });

    it('issues a session for a demo account and records it for unseed', async () => {
        await seedDemoTeam({ accountsPath, adapter });
        const priya = rows(SCHEMA_TYPE.USERS).find((u) => u.Employee_Email === 'priya.frontend@demo.test');

        const out = await issueSessionToken({ email: 'PRIYA.frontend@demo.test', accountsPath, adapter });

        expect(out).toEqual({ accessToken: 'header.payload.signature', companyId, expiresInSeconds: 3600 });
        expect(adapter.issueSession).toHaveBeenCalledWith(priya._id);
        expect(readAccounts(accountsPath).companies[companyId].records.sessions).toHaveLength(1);
        expect((await unseedDemoTeam({ accountsPath }))[companyId].sessions).toBe(1);
    });
});
