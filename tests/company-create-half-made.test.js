process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockRefusals = [];
const mockDbFor = (db) => (mockDbs[db] = mockDbs[db] || create());
const mockCrud = async (db, query, method) => {
    const refusal = mockRefusals.find((rule) => rule.db === String(db) && rule.type === query.type && rule.method === method);
    if (refusal) {
        refusal.tries += 1;
        if (refusal.tries <= refusal.times) throw new Error(`the database refused ${method} on ${query.type}`);
    }
    return mockDbFor(String(db)).crud(db, query, method);
};

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn(async () => {}) }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));
jest.mock('../Modules/Auth/controller/helper.js', () => ({}));
jest.mock('../Modules/Auth/controller.js', () => ({
    addAndRemoveUserInMongodbNotificationCount: (...args) => jest.requireActual('../Modules/Auth/controller/authHelpers').addAndRemoveUserInMongodbNotificationCount(...args),
}));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));
jest.mock('../Modules/Affiliate/controller.js', () => ({ storeRefferalCode: jest.fn(async () => {}), checkAndStoreRefferalCode: jest.fn(async () => {}) }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFunForUpload: jest.fn(async () => {}), handleCreateCompanyDataStorageFun: jest.fn(async () => {}) }));
jest.mock('../Modules/createProject/sampleProject.js', () => ({ seedSampleProject: jest.fn(async () => {}) }));
jest.mock('../Modules/projectTabs/catalogue.js', () => ({ ensureViewCatalogue: jest.fn(async () => {}) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const path = require('node:path');
const { loadLocale, SOURCE_LOCALE, LOCALES_DIR } = require('../scripts/i18n-check');
const { handleCreateCompanyDataStorageFunForUpload } = require('../common-storage/common-server.js');
const { seedSampleProject } = require('../Modules/createProject/sampleProject.js');
const { storeRefferalCode } = require('../Modules/Affiliate/controller.js');
const { emitListener } = require('../Modules/Company/eventController.js');
const { sendAttachMail } = require('../Modules/service.js');
const { WORKSPACE_FAILURE } = require('../Modules/Company/helpers/workspaceFailure');
const companyCtrl = require('../Modules/Company/controller');

const OTHER_COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const READY = '6f0000000000000000000c78';
const NEXT_READY = '6f0000000000000000000c79';
const GLOBAL = SCHEMA_TYPE.GOLBAL;
const RETRIES = 3;

let app;
const previousFreeCount = process.env.FREE_COMPANY_COUNT;
const previousPaymentMethod = process.env.PAYMENTMETHOD;
const restoreEnv = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
};

beforeAll(async () => {
    process.env.FREE_COMPANY_COUNT = '-1';
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.post('/api/v2/company/create', companyCtrl.createCompanyV2);
    });
});
afterAll(() => {
    restoreEnv('FREE_COMPANY_COUNT', previousFreeCount);
    restoreEnv('PAYMENTMETHOD', previousPaymentMethod);
    return app.close();
});

const rowsOf = (db, type) => mockDbFor(db).store[type] || [];
const refuse = (db, type, method, times = Infinity) => {
    const rule = { db, type, method, times, tries: 0 };
    mockRefusals.push(rule);
    return rule;
};

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((db) => delete mockDbs[db]);
    mockRefusals.length = 0;
    delete process.env.PAYMENTMETHOD;
    emitListener.mockClear();
    sendAttachMail.mockClear();
    handleCreateCompanyDataStorageFunForUpload.mockReset();
    handleCreateCompanyDataStorageFunForUpload.mockResolvedValue();
    seedSampleProject.mockReset();
    seedSampleProject.mockResolvedValue();
    storeRefferalCode.mockReset();
    storeRefferalCode.mockResolvedValue();
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.USERS, { _id: CALLER, Employee_Email: 'caller@own.test', AssignCompany: [OTHER_COMPANY] });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.PRECOMPANIES, { _id: READY, isAvailable: true, pickupCount: 0 });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.PRECOMPANIES, { _id: NEXT_READY, isAvailable: true, pickupCount: 0 });
});

const create$ = (body = {}) => app.call('POST', '/api/v2/company/create', {
    token: signSession(CALLER, [OTHER_COMPANY]),
    body: { companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test', ...body },
});
const stopEvents = () => emitListener.mock.calls.filter(([, data]) => data.step === 'STOP').map(([, data]) => data);
const caller = () => rowsOf(GLOBAL, SCHEMA_TYPE.USERS).find((row) => String(row._id) === CALLER);
const companyRows = () => rowsOf(GLOBAL, SCHEMA_TYPE.COMPANIES);
const ownRowsIn = (companyId) => [SCHEMA_TYPE.COMPANY_USERS, SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, SCHEMA_TYPE.USERID]
    .flatMap((type) => rowsOf(companyId, type).filter((row) => String(row.userId) === CALLER));

const NOT_FINISHED = { status: false, code: 'not_finished', statusText: WORKSPACE_FAILURE.NOT_FINISHED.statusText };

describe('POST /api/v2/company/create, a whole workspace', () => {
    it('makes the company, the owner\'s seat and settings, and puts the company on the owner\'s account', async () => {
        const res = await create$();

        expect(res.body).toMatchObject({ status: true, companyId: READY });
        expect(companyRows().map((row) => String(row._id))).toEqual([READY]);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY, READY]);
        expect(rowsOf(READY, SCHEMA_TYPE.COMPANY_USERS)).toEqual([expect.objectContaining({ userId: CALLER, roleType: 1, status: 2 })]);
        expect(rowsOf(READY, SCHEMA_TYPE.NOTIFICATIONS_SETTINGS)).toHaveLength(1);
        expect(rowsOf(READY, SCHEMA_TYPE.USERID)).toHaveLength(1);
        expect(stopEvents()).toEqual([{ step: 'STOP', companyId: READY }]);
        expect(sendAttachMail).not.toHaveBeenCalled();
    });

    it('says it is made only once everything is done, so the page cannot open it before the reply', async () => {
        let stopsWhenTheLastStepRan;
        storeRefferalCode.mockImplementation(async () => { stopsWhenTheLastStepRan = stopEvents().length; });

        await create$();

        expect(stopsWhenTheLastStepRan).toBe(0);
        expect(stopEvents()).toHaveLength(1);
    });

    it('gets there when a step fails twice and works on the third try, without writing anything twice', async () => {
        const flaky = [
            refuse(GLOBAL, SCHEMA_TYPE.COMPANIES, 'save', 2),
            refuse(READY, SCHEMA_TYPE.COMPANY_USERS, 'findOneAndUpdate', 2),
            refuse(GLOBAL, SCHEMA_TYPE.USERS, 'findOneAndUpdate', 2),
        ];

        const res = await create$();

        expect(res.body).toMatchObject({ status: true, companyId: READY });
        expect(flaky.map((rule) => rule.tries)).toEqual([RETRIES, RETRIES, RETRIES]);
        expect(companyRows()).toHaveLength(1);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY, READY]);
        expect(ownRowsIn(READY)).toHaveLength(3);
    });
});

describe('POST /api/v2/company/create, when a step the workspace cannot do without keeps failing', () => {
    it.each([
        ['the company row', GLOBAL, SCHEMA_TYPE.COMPANIES, 'save'],
        ['the owner\'s seat', READY, SCHEMA_TYPE.COMPANY_USERS, 'findOneAndUpdate'],
        ['the owner\'s notification settings', READY, SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, 'findOneAndUpdate'],
        ['the company on the owner\'s account', GLOBAL, SCHEMA_TYPE.USERS, 'findOneAndUpdate'],
    ])('answers a plain failure and keeps nothing when %s cannot be written', async (_, db, type, method) => {
        const rule = refuse(db, type, method, RETRIES);

        const res = await create$();

        expect(res.body).toEqual(NOT_FINISHED);
        expect(rule.tries).toBe(RETRIES);
        expect(stopEvents()).toEqual([{ step: 'STOP', error: NOT_FINISHED.statusText, code: 'not_finished' }]);
        expect(companyRows()).toEqual([]);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY]);
        expect(ownRowsIn(READY)).toEqual([]);
        expect(sendAttachMail).toHaveBeenCalledTimes(1);
    });

    it('does not go on to the later steps of a workspace it is not keeping', async () => {
        refuse(GLOBAL, SCHEMA_TYPE.COMPANIES, 'save');

        await create$({ teamFocus: 'software', seedSampleProject: true });

        expect(handleCreateCompanyDataStorageFunForUpload).not.toHaveBeenCalled();
        expect(seedSampleProject).not.toHaveBeenCalled();
        expect(storeRefferalCode).not.toHaveBeenCalled();
    });

    it('lets the same name be used again: the next try makes a whole workspace', async () => {
        refuse(READY, SCHEMA_TYPE.COMPANY_USERS, 'findOneAndUpdate');
        const first = await create$();
        const second = await create$();

        expect(first.body).toEqual(NOT_FINISHED);
        expect(second.body).toMatchObject({ status: true, companyId: NEXT_READY });
        expect(companyRows().map((row) => [String(row._id), row.Cst_CompanyName])).toEqual([[NEXT_READY, 'Fresh Co']]);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY, NEXT_READY]);
        expect(ownRowsIn(READY)).toEqual([]);
    });

    it('does not offer the company it gave up on to the next sign-up', async () => {
        refuse(GLOBAL, SCHEMA_TYPE.USERS, 'findOneAndUpdate', RETRIES);
        await create$();

        const reserved = rowsOf(GLOBAL, SCHEMA_TYPE.PRECOMPANIES).find((row) => String(row._id) === READY);
        expect(reserved.pickupCount).toBe(1);
    });

    it('still answers the failure when what it made cannot be taken back, and reports what is left', async () => {
        refuse(READY, SCHEMA_TYPE.COMPANY_USERS, 'findOneAndUpdate');
        refuse(GLOBAL, SCHEMA_TYPE.COMPANIES, 'deleteOne');

        const res = await create$();

        expect(res.body).toEqual(NOT_FINISHED);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY]);
        expect(sendAttachMail).toHaveBeenCalledTimes(1);
        expect(sendAttachMail.mock.calls[0][1]).toContain('the company row');
    });
});

describe('POST /api/v2/company/create, when a step the workspace can do without fails', () => {
    const whole = (res) => {
        expect(res.body).toMatchObject({ status: true, companyId: READY });
        expect(companyRows()).toHaveLength(1);
        expect(caller().AssignCompany).toEqual([OTHER_COMPANY, READY]);
        expect(stopEvents()).toEqual([{ step: 'STOP', companyId: READY }]);
    };

    it('opens the workspace without the unread counter row, and reports it', async () => {
        refuse(READY, SCHEMA_TYPE.USERID, 'save');

        whole(await create$());
        expect(sendAttachMail).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the logo cannot be stored', () => handleCreateCompanyDataStorageFunForUpload.mockRejectedValue(new Error('ENOSPC: /srv/storage'))],
        ['the sample project cannot be made', () => seedSampleProject.mockRejectedValue(new Error('no template'))],
        ['the referral code cannot be stored', () => storeRefferalCode.mockRejectedValue(new Error('referral store down'))],
    ])('opens the workspace when %s, and reports it without the raw error in the reply', async (_, fail) => {
        fail();

        const res = await create$({ teamFocus: 'software', seedSampleProject: true });

        whole(res);
        expect(JSON.stringify(res.body)).not.toMatch(/ENOSPC|no template|referral store down/);
        expect(sendAttachMail).toHaveBeenCalledTimes(1);
    });

    it('opens the workspace on a server with a payment method configured', async () => {
        process.env.PAYMENTMETHOD = 'chargebee';

        const res = await create$();

        whole(res);
        expect(res.body.paymentObj).toEqual({});
    });
});

describe('the reasons a workspace is not made', () => {
    const en = loadLocale(path.join(LOCALES_DIR, `${SOURCE_LOCALE}.js`));

    it('each have a code the page can translate', () => {
        const codes = Object.values(WORKSPACE_FAILURE).map((failure) => failure.code);

        expect(codes).toEqual([...new Set(codes)]);
        codes.forEach((code) => expect(code).toMatch(/^[a-z_]+$/));
        expect(codes.filter((code) => typeof en.Auth[`workspace_reason_${code}`] !== 'string')).toEqual([]);
    });

    it('come with the code beside the sentence when the details sent are not valid', async () => {
        const res = await create$({ teamSize: 'a crowd' });

        expect(res.body).toEqual({ status: false, code: 'invalid_details', statusText: 'teamSize is invalid' });
    });
});
