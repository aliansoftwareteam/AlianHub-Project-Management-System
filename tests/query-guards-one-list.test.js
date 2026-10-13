jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const callerRules = require('../Modules/Company/helpers/callerQueryRules');
const taskGuard = require('../Modules/Tasks/helpers/taskQueryGuard');
const invoiceGuard = require('../Modules/Invoice/helpers/invoiceQueryGuard');

const GUARDS = [
    ['a task query', taskGuard.FORBIDDEN_OPERATORS, taskGuard.validatePipeline, taskGuard.QueryRefused],
    ['an invoice query', invoiceGuard.FORBIDDEN_OPERATORS, invoiceGuard.validateInvoicePipeline, invoiceGuard.InvoiceQueryRefused],
];

const NESTINGS = [
    ['in a $match', (operator) => [{ $match: { [operator]: {} } }]],
    ['under $and and $or in a $match', (operator) => [{ $match: { $and: [{ $or: [{ [operator]: {} }] }] } }]],
    ['under $expr in a $match', (operator) => [{ $match: { $expr: { $eq: [{ [operator]: {} }, 1] } } }]],
    ['in a $project', (operator) => [{ $project: { value: { $cond: [true, { [operator]: {} }, 0] } } }]],
];

const nested = (depth) => {
    let filter = { name: 'x' };
    for (let level = 0; level < depth; level += 1) filter = { $and: [filter] };
    return [{ $match: filter }];
};

describe.each(GUARDS)('%s', (_label, forbidden, validate, Refused) => {
    it('holds every operator of the one list of what a caller\'s query never holds', () => {
        expect(callerRules.FORBIDDEN_OPERATORS.filter((operator) => !forbidden.includes(operator))).toEqual([]);
    });

    it('keeps its own rule that $facet is never nested', () => {
        expect(forbidden).toContain('$facet');
        expect(() => validate([{ $match: { $facet: {} } }])).toThrow(Refused);
    });

    it.each(callerRules.FORBIDDEN_OPERATORS.flatMap((operator) => NESTINGS.map(([where, nest]) => [operator, where, nest(operator)])))(
        'refuses %s %s', (_operator, _where, pipeline) => {
            expect(() => validate(pipeline)).toThrow(Refused);
        },
    );

    it('takes a query nested as deeply as the one list allows, and no deeper', () => {
        expect(callerRules.queryRefusal(nested(15)[0].$match)).toBeNull();
        expect(() => validate(nested(15))).not.toThrow();
        expect(callerRules.queryRefusal(nested(30)[0].$match)).toBe(callerRules.NESTED_TOO_DEEPLY);
        expect(() => validate(nested(30))).toThrow(Refused);
    });

    it('still takes the queries the screens send', () => {
        expect(() => validate([{ $match: { deletedStatusKey: { $in: [0, undefined] }, $or: [{ a: 1 }, { b: { $regex: 'x', $options: 'i' } }] } }, { $sort: { createdAt: -1 } }, { $skip: 0 }, { $limit: 15 }])).not.toThrow();
    });
});
