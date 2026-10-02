const verified = require('./fixtures/verifiedRequest');

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return { ...real, promises: { ...real.promises, mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) } };
});

const fs = require('fs');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const exportJobs = require('../Modules/ExportJobs/controller');
const { workspaceTaskRow } = require('../Modules/ExportJobs/helpers/exportRules');

const COMPANY = '6f0000000000000000000c21';
const OTHER_COMPANY = '6f0000000000000000000c22';
const OWNER = '6f00000000000000000000a1';
const MEMBER = '6f00000000000000000000b2';
const JOB = '6f0000000000000000000e21';
const PROJECT_A = '6f0000000000000000000d21';
const PROJECT_B = '6f0000000000000000000d22';
const ROLE = { owner: 1, admin: 2, member: 3, guest: 4 };

const fakeReq = ({ uid, body = {}, params = {}, query = {} } = {}) => verified({ uid, headers: { companyid: COMPANY }, body, params, query });
const fakeRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    res.download = jest.fn(() => res);
    return res;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const calls = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);

beforeEach(() => {
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (_companyId, uid) => (uid === OWNER ? ROLE.owner : ROLE.member));
});

describe('starting a workspace export', () => {
    it.each(['member', 'guest'])('is refused to a %s, with no job recorded', async (role) => {
        getRoleType.mockResolvedValue(ROLE[role]);
        const res = fakeRes();
        await exportJobs.createWorkspaceExport(fakeReq({ uid: MEMBER, body: { format: 'xlsx' } }), res);
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(calls('save')).toHaveLength(0);
    });

    it.each(['owner', 'admin'])('queues a job for an %s, in the session company and under the session user', async (role) => {
        getRoleType.mockResolvedValue(ROLE[role]);
        MongoDbCrudOpration.mockImplementation(async (companyId, obj, method) => (method === 'save' ? { _id: JOB, ...obj.data } : null));
        const res = fakeRes();
        await exportJobs.createWorkspaceExport(fakeReq({ uid: OWNER, body: { format: 'csv', userId: MEMBER } }), res);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ _id: JOB, type: 'workspace', status: 'queued' });
        expect(res.body.data.filePath).toBeUndefined();
        const [companyId, { type, data }] = calls('save')[0];
        expect(companyId).toBe(COMPANY);
        expect(type).toBe('exportJobs');
        expect(data).toMatchObject({ userId: OWNER, type: 'workspace', format: 'csv', status: 'queued' });
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, OWNER);
        await flush();
    });

    it('refuses an unknown format', async () => {
        const res = fakeRes();
        await exportJobs.createWorkspaceExport(fakeReq({ uid: OWNER, body: { format: 'pdf' } }), res);
        expect(res.body.status).toBe(false);
        expect(calls('save')).toHaveLength(0);
    });

    it('refuses a token for another company', async () => {
        const res = fakeRes();
        await exportJobs.createWorkspaceExport({ ...fakeReq({ uid: OWNER }), aud: OTHER_COMPANY }, res);
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(calls('save')).toHaveLength(0);
    });
});

describe('running a workspace export', () => {
    const job = { _id: JOB, userId: OWNER, type: 'workspace', format: 'csv', filters: {} };

    const runWith = async (owner = OWNER) => {
        MongoDbCrudOpration.mockImplementation(async (companyId, obj, method) => {
            if (method === 'save') return { _id: JOB, ...obj.data };
            if (method === 'findOne') return { ...job, userId: owner };
            if (method === 'find' && obj.type === 'projects') return [{ _id: PROJECT_A, ProjectName: 'Alpha', ProjectCode: 'AL' }, { _id: PROJECT_B, ProjectName: 'Beta', ProjectCode: 'BE' }];
            if (method === 'find' && obj.type === 'tasks') return [{ ProjectID: PROJECT_A, TaskKey: 'AL-1', TaskName: 'One' }, { ProjectID: PROJECT_B, TaskKey: 'BE-1', TaskName: 'Two' }];
            return null;
        });
        getRoleType.mockImplementation(async (_companyId, uid) => (uid === OWNER ? ROLE.owner : ROLE.member));
        await exportJobs.createWorkspaceExport(fakeReq({ uid: OWNER, body: { format: 'csv' } }), fakeRes());
        await flush();
        await flush();
    };

    it('reads every live project and its tasks in the session company, and finishes the job', async () => {
        await runWith();
        const reads = calls('find');
        expect(reads.every(([companyId]) => companyId === COMPANY)).toBe(true);
        expect(reads[0][1].data[0]).toMatchObject({ deletedStatusKey: { $nin: [1] } });
        expect(reads[1][1].data[0].ProjectID.$in.map(String)).toEqual([PROJECT_A, PROJECT_B]);
        const csv = fs.promises.writeFile.mock.calls[0][1];
        expect(csv).toContain('Alpha');
        expect(csv).toContain('BE-1');
        expect(calls('updateOne').pop()[1].data[1].$set).toMatchObject({ status: 'done', total: 2 });
    });

    it('fails a job whose owner has lost the role since starting it', async () => {
        await runWith(MEMBER);
        expect(calls('find')).toHaveLength(0);
        expect(calls('updateOne').pop()[1].data[1].$set).toMatchObject({ status: 'failed' });
    });

    it('names the project on every row', () => {
        expect(workspaceTaskRow({ TaskName: '=cmd()' }, { ProjectName: '+Evil', ProjectCode: 'EV' })).toMatchObject({ Project: "'+Evil", ProjectKey: 'EV', TaskName: "'=cmd()" });
    });
});

describe('listing and downloading exports', () => {
    it('lists the caller\'s own jobs with their type', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        const res = fakeRes();
        await exportJobs.listExports(fakeReq({ uid: OWNER }), res);
        const [companyId, { data }] = MongoDbCrudOpration.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(data[0]).toEqual({ userId: OWNER });
        expect(data[1].split(' ')).toEqual(expect.arrayContaining(['type', 'status', 'fileName', 'createdAt']));
        expect(data[1]).not.toContain('filePath');
    });

    it('downloads a finished workspace export for an owner', async () => {
        MongoDbCrudOpration.mockResolvedValue({ type: 'workspace', status: 'done', filePath: '/x.csv', fileName: 'x.csv' });
        const res = fakeRes();
        await exportJobs.downloadExport(fakeReq({ uid: OWNER, params: { id: JOB } }), res);
        expect(res.download).toHaveBeenCalledWith('/x.csv', 'x.csv');
    });

    it('does not hand a workspace export to someone who is no longer an owner or admin', async () => {
        MongoDbCrudOpration.mockResolvedValue({ type: 'workspace', status: 'done', filePath: '/x.csv', fileName: 'x.csv' });
        const res = fakeRes();
        await exportJobs.downloadExport(fakeReq({ uid: MEMBER, params: { id: JOB } }), res);
        expect(res.statusCode).toBe(404);
        expect(res.download).not.toHaveBeenCalled();
    });

    it('registers the workspace route beside the others', () => {
        const table = {};
        const record = (method) => (route, ...handlers) => { table[`${method} ${route}`] = handlers; };
        require('../Modules/ExportJobs/routes').init({ get: record('GET'), post: record('POST') });
        expect(Object.keys(table)).toEqual(expect.arrayContaining(['POST /api/v2/exports/workspace', 'GET /api/v2/exports', 'GET /api/v2/exports/:id/download']));
    });
});
