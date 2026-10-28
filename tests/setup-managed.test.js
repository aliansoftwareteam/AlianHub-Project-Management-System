jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => 0) }));
jest.mock('../Modules/Instance/health', () => ({ checkDb: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/Setup/initalizations', () => ({ startInitialization: jest.fn() }));
jest.mock('../Modules/Setup/createCompany', () => ({ createOwner: jest.fn(), createFirstCompany: jest.fn() }));

const hostingMode = require('../Config/hostingMode');
const { startInitialization } = require('../Modules/Setup/initalizations');
const ctrl = require('../Modules/Setup/controller');

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const owner = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'Correct-h0rse', companyName: 'Engines' };
const savedMode = process.env.HOSTING_MODE;
const inMode = (mode) => {
    hostingMode._resetForTests();
    if (mode) process.env.HOSTING_MODE = mode; else delete process.env.HOSTING_MODE;
};

beforeEach(() => {
    jest.clearAllMocks();
    ctrl.resetInstalledFlag();
});
afterAll(() => inMode(savedMode));

describe('the setup wizard on a hosted instance', () => {
    beforeEach(() => inMode('managed'));

    it('refuses to create the owner: the platform does that', async () => {
        const res = reply();
        await ctrl.complete({ body: owner }, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, statusText: 'This workspace is created by AlianHub Cloud.' });
        expect(startInitialization).not.toHaveBeenCalled();
    });

    it('tells the page it is hosted, so it shows "being prepared" instead of the form', async () => {
        const res = reply();
        await ctrl.getStatus({}, res);
        expect(res.body.data).toMatchObject({ installed: false, dbOk: true, managed: true });
    });
});

describe('the setup wizard on a self-hosted instance', () => {
    beforeEach(() => inMode(''));

    it('reports no hosting flag at all', async () => {
        const res = reply();
        await ctrl.getStatus({}, res);
        expect(res.body.data).not.toHaveProperty('managed');
    });

    it('still accepts the first owner', async () => {
        const res = reply();
        await ctrl.complete({ body: { ...owner, password: 'x' } }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.data.errors).toEqual({ password: 'weak' });
    });
});
