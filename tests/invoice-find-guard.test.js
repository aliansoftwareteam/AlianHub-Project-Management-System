const mockCrud = jest.fn(async () => [{ _id: 'inv1' }]);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));

const { validateInvoicePipeline, InvoiceQueryRefused, MAX_LIMIT } = require('../Modules/Invoice/helpers/invoiceQueryGuard');
const ctrl = require('../Modules/Invoice/controller');

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

beforeEach(() => mockCrud.mockClear());

describe('TIM-05 invoice pipeline guard', () => {
    it('accepts a lone stage object and a pipeline array', () => {
        expect(validateInvoicePipeline({ $match: { companyId: 'c1' } })).toEqual([{ $match: { companyId: 'c1' } }]);
        expect(validateInvoicePipeline([{ $match: {} }, { $sort: { createdAt: -1 } }, { $limit: 5 }])).toHaveLength(3);
    });

    it.each([
        ['a plain filter object', { companyId: 'c1' }],
        ['a string', 'companyId'],
        ['a number', 7],
        ['an empty pipeline', []],
        ['a stage with two operators', [{ $match: {}, $sort: { a: 1 } }]],
        ['a stage outside the allowlist', [{ $lookup: { from: 'users', localField: 'a', foreignField: 'b', as: 'c' } }]],
        ['a write stage', [{ $out: 'stolen' }]],
        ['a cross-collection union', [{ $unionWith: 'users' }]],
        ['server-side JavaScript in a match', [{ $match: { $where: 'true' } }]],
        ['a function hidden in a projection', [{ $project: { x: { $function: { body: 'x', args: [], lang: 'js' } } } }]],
        ['a negative skip', [{ $skip: -1 }]],
    ])('refuses %s', (label, body) => {
        expect(() => validateInvoicePipeline(body)).toThrow(InvoiceQueryRefused);
    });

    it('clamps an oversized limit', () => {
        expect(validateInvoicePipeline([{ $limit: 1e9 }])).toEqual([{ $limit: MAX_LIMIT }]);
    });
});

describe('TIM-05 POST /api/v1/invoice/find', () => {
    it('answers 400 for a body that is not a pipeline and never queries', async () => {
        const r = res();
        await ctrl.getInvoice({ body: { findQuery: { companyId: 'c1' } } }, r);
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false });
        expect(r.body.message).toMatch(/exactly one pipeline operator/);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 400 when findQuery is missing', async () => {
        const r = res();
        await ctrl.getInvoice({ body: {} }, r);
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
    });

    it('runs a valid pipeline against the invoices collection', async () => {
        const r = res();
        await ctrl.getInvoice({ body: { findQuery: [{ $match: { companyId: 'c1' } }] } }, r);
        expect(r.code).toBe(200);
        expect(r.body).toEqual([{ _id: 'inv1' }]);
        const [, query, method] = mockCrud.mock.calls[0];
        expect(method).toBe('aggregate');
        expect(query.data).toEqual([[{ $match: { companyId: 'c1' } }]]);
    });
});
