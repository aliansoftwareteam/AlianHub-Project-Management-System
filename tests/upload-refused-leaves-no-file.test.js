/* A request that is refused, or whose file nothing reads, leaves no file on the server. */
process.env.STORAGE_TYPE = 'server';

const mockAi = { configured: true };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null), validateObjectId: () => true }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: jest.fn(), del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/jwt', () => ({ requireLiveCompanyMembership: (req, res, next) => next(), verifyCompanyMembership: jest.fn(async () => true) }));
const mockReached = () => new Proxy({}, {
    get: (target, name) => (typeof name !== 'string' || name === 'then' || name === '__esModule'
        ? undefined
        : (req, res) => res.json({ reached: true, body: req.body, file: req.file ? req.file.path : null })),
});
jest.mock('../Modules/Company/controller', () => mockReached());
jest.mock('../Modules/Company/eventController', () => ({ handleEvents: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => mockReached());
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => mockAi.configured }));

const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { myCache } = require('../Config/config');

const hex = () => crypto.randomBytes(12).toString('hex');
const USER = hex();
const COMPANY = hex();
const OTHER_COMPANY = hex();
const COMPANY_TEMP = path.resolve('wasabiUploads');
const BRIEF_TEMP = path.join(os.tmpdir(), 'alianhub-ai-briefs');
const FORM_TEMP = path.join(os.tmpdir(), 'alianhub-form-uploads');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

let server;
let baseURL;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
        if (req.headers['x-uid']) req.uid = req.headers['x-uid'];
        if (req.headers['x-aud']) req.aud = req.headers['x-aud'];
        next();
    });
    ['Company', 'AIProjectGenerator', 'Forms'].forEach((name) => require(`../Modules/${name}/routes`).init(app));
    app.use((err, _req, res, _next) => res.status(500).json({ status: false, statusText: err.message }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

beforeEach(() => {
    mockAi.configured = true;
    myCache.set.mockClear();
});

const signedIn = { 'x-uid': USER, 'x-aud': COMPANY, companyid: COMPANY };
const post = (url, form, headers = {}) => fetch(`${baseURL}${url}`, { method: 'POST', headers, body: form });
const formOf = (fields, file) => {
    const form = new FormData();
    Object.entries(fields).forEach(([name, value]) => form.append(name, value));
    if (file) form.append(file.field || 'file', new Blob([file.bytes], { type: file.type }), file.name);
    return form;
};

describe('creating a workspace', () => {
    it('reads the fields of a multipart request and stores no file from it', async () => {
        const before = filesIn(COMPANY_TEMP);
        const res = await post('/api/v2/company/create', formOf({ companyName: 'Acme' }, { bytes: PNG, type: 'image/png', name: 'logo.png' }), signedIn);

        expect(await res.json()).toEqual({ reached: true, body: { companyName: 'Acme' }, file: null });
        expect(filesIn(COMPANY_TEMP)).toEqual(before);
    });
});

describe('uploading a brief for a new project', () => {
    const BRIEF = '/api/v1/ai/project/upload-brief';
    const brief = (fields = {}) => formOf(fields, { bytes: 'Build a billing tool in six weeks.', type: 'text/plain', name: 'brief.txt' });

    it.each([
        ['the AI is not set up', () => { mockAi.configured = false; return signedIn; }, 503],
        ['nobody is signed in', () => ({ companyid: COMPANY }), 401],
        ['the person is in no company', () => ({ 'x-uid': USER, companyid: COMPANY }), 403],
    ])('is refused before the file is read when %s', async (_why, headersOf, code) => {
        const before = filesIn(BRIEF_TEMP);
        const res = await post(BRIEF, brief(), headersOf());

        expect(res.status).toBe(code);
        expect(filesIn(BRIEF_TEMP)).toEqual(before);
        expect(myCache.set).not.toHaveBeenCalled();
    });

    it('leaves no file when the fields of the request name another company', async () => {
        const before = filesIn(BRIEF_TEMP);
        const res = await post(BRIEF, brief({ companyId: OTHER_COMPANY }), signedIn);

        expect(res.status).toBe(403);
        expect(filesIn(BRIEF_TEMP)).toEqual(before);
        expect(myCache.set).not.toHaveBeenCalled();
    });

    it('is read for a signed-in person of the company, and the file is gone once it is read', async () => {
        const before = filesIn(BRIEF_TEMP);
        const res = await post(BRIEF, brief(), signedIn);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: true, mimetype: 'text/plain' });
        expect(filesIn(BRIEF_TEMP)).toEqual(before);
    });

    it('has every check that needs no file in front of the upload', () => {
        const { uploadBrief } = require('../Modules/AIProjectGenerator/controller');
        expect(uploadBrief.map((handler) => handler.name).slice(0, 2)).toEqual(['briefAsked', 'briefUploadMiddleware']);
    });
});

describe('a public form posted to a link that is not there', () => {
    it('keeps none of the files sent with it', async () => {
        const before = filesIn(FORM_TEMP);
        const res = await post(`/form/${crypto.randomBytes(24).toString('hex')}`, formOf({ q1: 'Hello' }, { field: 'q2', bytes: PNG, type: 'image/png', name: 'shot.png' }));

        expect(res.status).toBe(404);
        expect(filesIn(FORM_TEMP)).toEqual(before);
    });
});
