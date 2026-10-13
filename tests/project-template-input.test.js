const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const { createTemplate } = require('../Modules/ProjectTemplates/controller');

const COMPANY = '6f00000000000000000cd001';

const run = async (body) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await createTemplate({ body, headers: { companyid: COMPANY } }, res);
    return res;
};

beforeEach(() => jest.clearAllMocks());

describe('creating a custom project template with bad input (PRJ-06)', () => {
    test.each([
        [{}, 'data'],
        [{ data: null }, 'data'],
        [{ data: 'template' }, 'data'],
        [{ data: [] }, 'data'],
        [{ data: { TemplateName: '  ' } }, 'TemplateName'],
        [{ data: { TemplateName: 'x'.repeat(251) } }, 'TemplateName'],
    ])('%j is a 400 naming %s, before the database is touched', async (body, field) => {
        const res = await run(body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ status: false, field }));
        expect(mockCrud).not.toHaveBeenCalled();
    });

    test('a partial template the schema rejects is a 400 that leaks no schema field names', async () => {
        mockCrud.mockRejectedValueOnce(Object.assign(
            new Error('companyProjectTemplate validation failed: ProjectCurrency: Path `ProjectCurrency` is required., ProjectRequiredDefaultComponent: Path `ProjectRequiredDefaultComponent` is required.'),
            { name: 'ValidationError', errors: { ProjectCurrency: {}, ProjectRequiredDefaultComponent: {} } },
        ));
        const res = await run({ data: { TemplateName: 'Partial' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(/ProjectCurrency|ProjectRequiredDefaultComponent|validation failed|Path/);
    });

    test('an unexpected failure is a 500 without the raw error', async () => {
        mockCrud.mockRejectedValueOnce(new Error('connection reset by mongod'));
        const res = await run({ data: { TemplateName: 'Broken' } });
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('mongod');
    });

    test('a complete template is saved and the template cache cleared', async () => {
        mockCrud.mockResolvedValueOnce({ _id: 't1', TemplateName: 'Complete' });
        const res = await run({ data: { TemplateName: 'Complete' } });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ status: true, data: { _id: 't1', TemplateName: 'Complete' } }));
        expect(mockCrud).toHaveBeenCalledWith(COMPANY, { type: SCHEMA_TYPE.PROJECT_TEMPLATES, data: { TemplateName: 'Complete' } }, 'save');
        expect(removeCache).toHaveBeenCalledWith(`project_template_${COMPANY}`);
    });
});
