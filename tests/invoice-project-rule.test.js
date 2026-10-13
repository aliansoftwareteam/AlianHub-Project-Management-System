jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, P_PERSONAL } = world;
const { seed } = world.create(mockDb);

const PEOPLE = [['the owner', OWNER], ['an admin', ADMIN], ['a member of the private project', INSIDER], ['a member', OUTSIDER]];
const OPEN_PROJECTS = { [OWNER]: [P_OPEN, P_PRIVATE], [ADMIN]: [P_OPEN, P_PRIVATE], [INSIDER]: [P_OPEN, P_PRIVATE, P_PERSONAL], [OUTSIDER]: [P_OPEN] };
const INVOICE_OF = { [P_OPEN]: '6f0000000000000000000f01', [P_PRIVATE]: '6f0000000000000000000f02', [P_PERSONAL]: '6f0000000000000000000f03' };

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/Invoice/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
    return table;
};

/* [the route, how a request names the project or the invoice] */
const NAMED = {
    'GET /api/v2/invoices': (projectId) => ({ query: { projectId } }),
    'POST /api/v2/invoices/draft-from-milestone': (projectId) => ({ body: { projectId, milestoneId: '6f0000000000000000000e01' } }),
    'POST /api/v2/invoices/draft-from-month': (projectId) => ({ body: { projectId, month: '2026-09' } }),
    'GET /api/v2/invoices/:id': (projectId) => ({ params: { id: INVOICE_OF[projectId] } }),
    'PUT /api/v2/invoices/:id': (projectId) => ({ params: { id: INVOICE_OF[projectId] }, body: { notes: 'Thanks' } }),
    'POST /api/v2/invoices/:id/send': (projectId) => ({ params: { id: INVOICE_OF[projectId] } }),
    'POST /api/v2/invoices/:id/paid': (projectId) => ({ params: { id: INVOICE_OF[projectId] } }),
    'DELETE /api/v2/invoices/:id': (projectId) => ({ params: { id: INVOICE_OF[projectId] }, query: { projectId } }),
};

const reaches = async (route, uid, projectId) => {
    const guards = routes()[route].slice(0, -1);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = () => res;
    res.send = res.json;
    const req = { uid, headers: { companyid: CID }, aud: CID, params: {}, query: {}, body: {}, ...NAMED[route](projectId) };
    for (const guard of guards) {
        let advanced = false;
        await guard(req, res, () => { advanced = true; });
        if (!advanced) return res.statusCode;
    }
    return 'reached';
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    Object.entries(INVOICE_OF).forEach(([ProjectID, _id]) => mockDb.seed(SCHEMA_TYPE.PROJECT_INVOICES, { _id, ProjectID, number: 'INV-1', status: 'draft', deletedStatusKey: 0, lines: [] }));
});

describe('the invoices of a project', () => {
    const cases = Object.keys(NAMED).flatMap((route) => PEOPLE.map(([who, uid]) => [route, who, uid]));

    it.each(cases)('%s is reached by %s for a project they can open, and answers 404 for any other', async (route, who, uid) => {
        const answers = {};
        for (const projectId of [P_OPEN, P_PRIVATE, P_PERSONAL]) answers[projectId] = await reaches(route, uid, projectId);
        expect(answers).toEqual(Object.fromEntries([P_OPEN, P_PRIVATE, P_PERSONAL].map((projectId) => [projectId, OPEN_PROJECTS[uid].includes(projectId) ? 'reached' : 404])));
    });
});
