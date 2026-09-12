jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const billing = require('../Modules/Milestone/controller/billing');
const clientView = require('../Modules/Milestone/controller/clientView');

const COMPANY = '6a9954186dd786246031e47b';
const OTHER_COMPANY = '6a9954186dd786246031e47d';
const USER = '6a9954186dd786246031e47c';
const PROJECT = '6a9954186dd786246031e47e';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

const call = (handler, req) => {
    const r = res();
    return Promise.resolve(handler({ headers: { companyid: COMPANY }, query: {}, body: {}, uid: USER, aud: COMPANY, ...req }, r)).then(() => r);
};

const context = {
    project: { ProjectName: 'Client Project' },
    contract: { clientContactIds: [], currency: 'USD' },
    milestones: [{ id: 'm1', name: 'Kickoff', dueDate: '2026-03-01', percentBp: 10000, signOffAt: '2026-03-02' }],
    tasks: [],
    invoices: [],
};

beforeEach(() => {
    MongoDbCrudOpration.mockReset();
    jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(context);
});

afterEach(() => jest.restoreAllMocks());

/* The five names clientView destructures off billing. companyOf was deleted from billing with
 * the tenancy rewrite and nothing caught it, so both routes threw on every request. */
describe('the billing module still exports everything the client view destructures', () => {
    it.each([['actorId'], ['isObjectIdString'], ['toEpoch'], ['DONE_STATUS_TYPE']])('exports %s', (name) => {
        expect(billing[name]).toBeDefined();
    });

    it('no longer exports companyOf, so nothing may destructure it', () => {
        expect(billing.companyOf).toBeUndefined();
    });
});

describe('GET /api/v2/billing/client-view', () => {
    it('answers with the client payload', async () => {
        const r = await call(clientView.getClientView, { query: { projectId: PROJECT } });

        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body.data.project).toMatchObject({ name: 'Client Project' });
        expect(billing.buildBillingContext).toHaveBeenCalledWith(COMPANY, PROJECT);
    });

    it('refuses a body that names another company', async () => {
        const r = await call(clientView.getClientView, { query: { projectId: PROJECT }, body: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false });
        expect(billing.buildBillingContext).not.toHaveBeenCalled();
    });

    it('asks for a projectId rather than failing on one', async () => {
        const r = await call(clientView.getClientView, {});

        expect(r.body).toMatchObject({ status: false, statusText: 'A valid projectId is required.' });
    });
});

describe('POST /api/v2/billing/client-view/message', () => {
    it('saves the message and answers', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
            if (obj.type === SCHEMA_TYPE.PROJECT_CONTRACTS) return { allowClientMessages: true };
            if (method === 'save') return { _id: 'c1' };
            return null;
        });

        const r = await call(clientView.postClientMessage, { body: { projectId: PROJECT, message: 'Looks good' } });

        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true, statusText: 'Message sent.' });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ type: SCHEMA_TYPE.COMMENTS }), 'save');
    });

    it('refuses a body that names another company, and writes nothing', async () => {
        const r = await call(clientView.postClientMessage, { body: { companyId: OTHER_COMPANY, projectId: PROJECT, message: 'Looks good' } });

        expect(r.code).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});
