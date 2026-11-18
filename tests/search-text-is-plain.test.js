/* Task 047, tenth sweep: what a person types into a search box is matched as text, never run as a
   pattern, whichever client built the query. The task route is the real one over a fake database. */
process.env.STORAGE_TYPE = 'server';

const path = require('path');
const mockWorld = require('./fixtures/extraListsWorld').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, query, method) => mockWorld.crud(companyId, query, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../Modules/Audit/recorder', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());

const { uidOf, P, L, routeCaller, routesOf } = require('./fixtures/extraListsWorld');
const {
    MAX_SEARCH_TEXT, SearchTextRefused, withPlainSearchText, limitCallerFilters, limitCallerBody,
} = require('../Modules/Company/helpers/callerQueryRules');
const { validatePipeline, QueryRefused } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { validateInvoicePipeline, InvoiceQueryRefused } = require('../Modules/Invoice/helpers/invoiceQueryGuard');

const call = routeCaller(routesOf(path.join(__dirname, '../Modules/Tasks/routes')));
const { task } = mockWorld;

const PARENT = `6f${'0'.repeat(19)}b30`;
const PRINT = `6f${'0'.repeat(19)}b31`;
const SESSION = `6f${'0'.repeat(19)}b32`;
const DOTTED = `6f${'0'.repeat(19)}b33`;
const SLASHED = `6f${'0'.repeat(19)}b34`;

const searchQuery = (text) => [{
    $match: { $and: [
        { $and: [{ ProjectID: { objId: { $in: [P.HOME] } } }, { deletedStatusKey: { $in: [0] } }] },
        { $or: [{ TaskName: { $regex: text, $options: 'i' } }] },
    ] },
}];
const search = (text) => call('POST /api/v1/task/find', uidOf.OWNER, { body: { findQuery: searchQuery(text) } });
const namesOf = (res) => {
    expect(res.code).toBe(200);
    return res.body.map((row) => row.TaskName).sort();
};

beforeEach(() => {
    mockWorld.reset();
    jest.clearAllMocks();
    task(PARENT, P.HOME, L.HOME, { TaskName: '[QA 047] parent' });
    task(PRINT, P.HOME, L.HOME, { TaskName: 'Print layout breaks' });
    task(SESSION, P.HOME, L.HOME, { TaskName: 'Session ends too early (again?)' });
});

describe('the text of a list search, as the server runs it', () => {
    test('square brackets are text: the task with that name is found', async () => {
        expect(namesOf(await search('[QA 047] parent'))).toEqual(['[QA 047] parent']);
    });

    test('a bracketed label finds the tasks that carry it and no others', async () => {
        expect(namesOf(await search('[QA 047]'))).toEqual(['[QA 047] parent']);
    });

    test('an opening bracket alone is answered, not failed', async () => {
        expect(namesOf(await search('[QA'))).toEqual(['[QA 047] parent']);
    });

    test('a question mark, a dot and round brackets are text too', async () => {
        expect(namesOf(await search('(again?)'))).toEqual(['Session ends too early (again?)']);
        expect(namesOf(await search('.*'))).toEqual([]);
    });

    test('a backslash is text too: each name is found by exactly what it holds', async () => {
        task(DOTTED, P.HOME, L.HOME, { TaskName: 'release a.b notes' });
        task(SLASHED, P.HOME, L.HOME, { TaskName: 'path a\\.b here' });
        expect(namesOf(await search('a.b'))).toEqual(['release a.b notes']);
        expect(namesOf(await search('a\\.b'))).toEqual(['path a\\.b here']);
        expect(namesOf(await search('\\[QA 047\\] parent'))).toEqual([]);
    });

    test('text longer than the cap is refused with a message a person can read', async () => {
        const res = await search('a'.repeat(MAX_SEARCH_TEXT + 1));
        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, message: expect.stringContaining(`at most ${MAX_SEARCH_TEXT} characters`) });
    });
});

describe('search text in a query a caller built', () => {
    test.each([
        ['plain text', 'landing page', 'landing page'],
        ['a bracket', '[QA', '\\[QA'],
        ['a pattern', '(a+)+$', '\\(a\\+\\)\\+\\$'],
        ['a backslash before a bracket', '\\[QA 047\\]', '\\\\\\[QA 047\\\\\\]'],
        ['a backslash before a dot', 'a\\.b', 'a\\\\\\.b'],
        ['a backslash before a letter', 'C:\\data', 'C:\\\\data'],
    ])('%s is matched as text', (_name, typed, pattern) => {
        expect(withPlainSearchText({ TaskName: { $regex: typed, $options: 'i' } })).toEqual({ TaskName: { $regex: pattern, $options: 'i' } });
    });

    test('it is found at any depth, and nothing else is changed', () => {
        const day = new Date('2026-10-02T00:00:00.000Z');
        const query = { $and: [{ createdAt: { $gte: day } }, { $or: [{ a: { $regex: 'x.y' } }, { $expr: { $regexMatch: { input: '$name', regex: 'a|b', options: 'i' } } }] }] };
        expect(withPlainSearchText(query)).toEqual({
            $and: [{ createdAt: { $gte: day } }, { $or: [{ a: { $regex: 'x\\.y' } }, { $expr: { $regexMatch: { input: '$name', regex: 'a\\|b', options: 'i' } } }] }],
        });
        expect(query.$and[1].$or[0].a.$regex).toBe('x.y');
    });

    test.each([
        ['text past the cap', { $regex: 'a'.repeat(MAX_SEARCH_TEXT + 1) }],
        ['a pattern that is not text', { $regex: { $concat: ['a', 'b'] } }],
        ['options that are not flags', { $regex: 'a', $options: 'i;' }],
    ])('%s is refused', (_name, condition) => {
        expect(() => withPlainSearchText({ TaskName: condition })).toThrow(SearchTextRefused);
    });

    test('a pattern computed inside the query is refused', () => {
        expect(() => withPlainSearchText({ $expr: { $regexMatch: { input: '$name', regex: { $toString: '$other' } } } })).toThrow(SearchTextRefused);
    });

    test('the task query guard returns the text form and refuses what is too long', () => {
        expect(validatePipeline([{ $match: { TaskName: { $regex: '[QA', $options: 'i' } } }])).toEqual([{ $match: { TaskName: { $regex: '\\[QA', $options: 'i' } } }]);
        expect(validatePipeline([{ $facet: { rows: [{ $match: { TaskKey: { $regex: 'A+' } } }] } }])).toEqual([{ $facet: { rows: [{ $match: { TaskKey: { $regex: 'A\\+' } } }] } }]);
        expect(() => validatePipeline([{ $match: { TaskName: { $regex: 'a'.repeat(MAX_SEARCH_TEXT + 1) } } }])).toThrow(QueryRefused);
    });

    test('the invoice query guard does the same', () => {
        expect(validateInvoicePipeline([{ $match: { invoiceNumber: { $regex: 'INV(1' } } }])).toEqual([{ $match: { invoiceNumber: { $regex: 'INV\\(1' } } }]);
        expect(() => validateInvoicePipeline([{ $match: { invoiceNumber: { $regex: 'a'.repeat(MAX_SEARCH_TEXT + 1) } } }])).toThrow(InvoiceQueryRefused);
    });

    const through = (middleware, body) => {
        const req = { body };
        const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
        const next = jest.fn();
        middleware(req, res, next);
        return { req, res, next };
    };

    test('a named filter of a request is rewritten before the handler reads it', () => {
        const { req, next } = through(limitCallerFilters('query'), { query: { $or: [{ ProjectName: { $regex: 'a.b', $options: 'i' } }] } });
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body.query).toEqual({ $or: [{ ProjectName: { $regex: 'a\\.b', $options: 'i' } }] });
    });

    test('a named filter with text past the cap answers 400', () => {
        const { res, next } = through(limitCallerFilters('query'), { query: { ProjectName: { $regex: 'a'.repeat(MAX_SEARCH_TEXT + 1) } } });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: false, message: expect.stringContaining('characters') }));
    });

    test('a whole request body is rewritten the same way', () => {
        const { req, next } = through(limitCallerBody, { filter: { TaskName: { $regex: 'a*' } }, limit: 5 });
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ filter: { TaskName: { $regex: 'a\\*' } }, limit: 5 });
    });
});
