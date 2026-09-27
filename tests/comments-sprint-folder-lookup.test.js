/* Task 040 phase 1: the comment search joins each comment's sprint, then the sprint's folder, to
   show the folder name. Legacy sprint rows hold folderId as text, and a $lookup compares BSON
   types strictly, so those comments came back without their folder. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');
const sift = require('sift');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 1),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { searchComments } = require('../Modules/Comments/controller');

const oid = (id) => new mongoose.Types.ObjectId(id);
const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';
const PROJECT = '6a9954186dd786246031e47d';
const FOLDER = '6a9954186dd786246031e490';
const SPRINT_ID_FOLDER = '6a9954186dd786246031e491';
const SPRINT_TEXT_FOLDER = '6a9954186dd786246031e492';
const SPRINT_NO_FOLDER = '6a9954186dd786246031e493';
const SPRINT_BAD_FOLDER = '6a9954186dd786246031e494';

const DB = {
    folders: [{ _id: oid(FOLDER), name: 'Design', deletedStatusKey: 0 }],
    sprints: [
        { _id: oid(SPRINT_ID_FOLDER), name: 'Stored as id', folderId: oid(FOLDER), deletedStatusKey: 0 },
        { _id: oid(SPRINT_TEXT_FOLDER), name: 'Stored as text', folderId: FOLDER, deletedStatusKey: 0 },
        { _id: oid(SPRINT_NO_FOLDER), name: 'At the root', deletedStatusKey: 0 },
        { _id: oid(SPRINT_BAD_FOLDER), name: 'Legacy key', folderId: 'legacy-folder-key', deletedStatusKey: 0 },
    ],
    comments: [SPRINT_ID_FOLDER, SPRINT_TEXT_FOLDER, SPRINT_NO_FOLDER, SPRINT_BAD_FOLDER].map((sprint) => ({
        _id: `in-${sprint}`, projectId: oid(PROJECT), sprintId: oid(sprint), message: 'hello', createdAt: new Date(),
    })),
};

/* An ObjectId equals only an ObjectId, as on the server; tagging keeps sift from reading it as its hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};
const sameBson = (a, b) => JSON.stringify(bson(a)) === JSON.stringify(bson(b));
const read = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

const HEX = /^[a-f0-9]{24}$/i;
const evaluate = (doc, expr) => {
    if (typeof expr === 'string' && expr.startsWith('$')) return read(doc, expr.slice(1));
    if (!expr || typeof expr !== 'object' || expr instanceof mongoose.Types.ObjectId) return expr;
    if (expr.$convert && expr.$convert.to === 'objectId') {
        const input = evaluate(doc, expr.$convert.input);
        if (input == null) return evaluate(doc, expr.$convert.onNull);
        if (input instanceof mongoose.Types.ObjectId) return input;
        return typeof input === 'string' && HEX.test(input) ? oid(input) : evaluate(doc, expr.$convert.onError);
    }
    throw new Error(`test evaluator: unsupported expression ${JSON.stringify(expr)}`);
};

const project = (doc, spec) => {
    const out = { _id: doc._id };
    Object.entries(spec).forEach(([key, value]) => {
        const v = value === 1 || value === true ? doc[key] : evaluate(doc, value);
        if (v !== undefined) out[key] = v;
    });
    return out;
};

const run = (docs, stages) => stages.reduce((rows, stage) => {
    if (stage.$match) return rows.filter((row) => sift(bson(stage.$match))(bson(row)));
    if (stage.$project) return rows.map((row) => project(row, stage.$project));
    if (stage.$lookup) {
        const { from, localField, foreignField, as, pipeline = [] } = stage.$lookup;
        return rows.map((row) => {
            const local = read(row, localField);
            const joined = DB[from].filter((f) => local !== undefined && local !== null && sameBson(read(f, foreignField), local));
            return { ...row, [as]: run(joined, pipeline) };
        });
    }
    if (stage.$unwind) {
        const path = stage.$unwind.path.slice(1);
        return rows.flatMap((row) => {
            const list = row[path] || [];
            if (list.length) return list.map((item) => ({ ...row, [path]: item }));
            return stage.$unwind.preserveNullAndEmptyArrays ? [{ ...row, [path]: undefined }] : [];
        });
    }
    if (stage.$sort || stage.$skip !== undefined || stage.$limit) return rows;
    throw new Error(`test evaluator: unsupported stage ${Object.keys(stage)[0]}`);
}, docs);

const folderShown = async () => {
    MongoDbCrudOpration.mockImplementation(async (companyId, { type, data: [pipeline] }, method) => {
        expect([companyId, type, method]).toEqual([COMPANY, 'comments', 'aggregate']);
        return run(DB.comments, pipeline);
    });
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await searchComments({ headers: { companyid: COMPANY }, uid: USER, body: { pids: [PROJECT] } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const rows = res.json.mock.calls[0][0].data;
    return Object.fromEntries(rows.map((row) => [row.sprintArray.name, row.folderArray ? row.folderArray.name : null]));
};

describe('the comment search shows the folder of each comment sprint', () => {
    test('whichever form the sprint stored its folder id in', async () => {
        const shown = await folderShown();
        expect(shown['Stored as id']).toBe('Design');
        expect(shown['Stored as text']).toBe('Design');
    });

    test('a sprint at the root, or with a folder key that is not an id, still lists its comments without a folder', async () => {
        const shown = await folderShown();
        expect(shown['At the root']).toBeNull();
        expect(shown['Legacy key']).toBeNull();
        expect(Object.keys(shown)).toHaveLength(4);
    });
});
