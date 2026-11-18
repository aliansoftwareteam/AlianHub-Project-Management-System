const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: jest.fn(() => false) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(),
    isCompanyMember: jest.fn(async () => true),
    isCompanyAdmin: jest.fn(async () => false),
    visibleProjectIds: jest.fn(async () => []),
}));
jest.mock('../common-storage/putLocalFile', () => ({
    putLocalFile: jest.fn(async ({ storagePath }) => ({ key: storagePath, consumedSource: false })),
}));

const fs = require('fs');
const express = require('express');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { projectAccess } = require('../Config/contentAccess');
const { putLocalFile } = require('../common-storage/putLocalFile');

const C = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000a01';
const EDITOR = '6f0000000000000000000001';
const READER = '6f0000000000000000000002';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let server;
let baseURL;
let caller = EDITOR;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.uid = caller; req.aud = C; next(); });
    require('../Modules/Pages/routes').init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

let page;
beforeEach(() => {
    caller = EDITOR;
    delete process.env.MAX_IMAGE_FILE_BYTES;
    mockDb = fakeMongo.create();
    putLocalFile.mockClear();
    projectAccess.mockImplementation(async (companyId, uid) => ({ visible: true, canEdit: uid === EDITOR }));
    page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Plan', ProjectID: PROJECT, visibility: 'project', createdBy: EDITOR, deletedStatusKey: 0 });
});

const upload = (bytes, name, type, pageId = page._id) => {
    const form = new FormData();
    if (bytes) form.append('file', new Blob([bytes], { type }), name);
    return fetch(`${baseURL}/api/v2/pages/${pageId}/images`, { method: 'POST', headers: { companyid: C }, body: form })
        .then((res) => res.json());
};

describe('PAGES - image upload', () => {
    test('an editor uploads an image into the doc folder of the company bucket', async () => {
        const body = await upload(PNG, 'chart.png', 'image/png');
        expect(body.status).toBe(true);
        expect(body.data.key).toMatch(new RegExp(`^Pages/${page._id}/[a-f0-9]{24}\\.png$`));
        expect(putLocalFile).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, storagePath: body.data.key }));
        const [{ tmpPath }] = putLocalFile.mock.calls[0];
        expect(fs.existsSync(tmpPath)).toBe(false);
    });

    test('someone who can read the doc but not edit it cannot add images', async () => {
        caller = READER;
        const body = await upload(PNG, 'chart.png', 'image/png');
        expect(body).toMatchObject({ status: false, statusCode: 404 });
        expect(putLocalFile).not.toHaveBeenCalled();
    });

    test('a doc that does not exist takes no upload', async () => {
        const body = await upload(PNG, 'chart.png', 'image/png', '6f0000000000000000000fff');
        expect(body).toMatchObject({ status: false, statusCode: 404 });
        expect(putLocalFile).not.toHaveBeenCalled();
    });

    test.each([
        ['an svg', SVG, 'drawing.svg', 'image/svg+xml'],
        ['a text file named like an image', Buffer.from('not really a png'), 'chart.png', 'image/png'],
        ['a pdf', Buffer.from('%PDF-1.4'), 'brief.pdf', 'application/pdf'],
        ['a png whose name says jpeg', PNG, 'chart.jpg', 'image/jpeg'],
    ])('refuses %s', async (_label, bytes, name, type) => {
        const body = await upload(bytes, name, type);
        expect(body).toMatchObject({ status: false, statusCode: 400 });
        expect(putLocalFile).not.toHaveBeenCalled();
    });

    test('refuses an image over the app-wide image size limit', async () => {
        process.env.MAX_IMAGE_FILE_BYTES = '2048';
        const body = await upload(Buffer.concat([PNG, Buffer.alloc(4096)]), 'big.png', 'image/png');
        expect(body).toMatchObject({ status: false, statusCode: 413 });
        expect(putLocalFile).not.toHaveBeenCalled();
    });

    test('asks for a file when none was sent', async () => {
        const body = await upload(null);
        expect(body).toMatchObject({ status: false, statusCode: 400 });
    });
});
