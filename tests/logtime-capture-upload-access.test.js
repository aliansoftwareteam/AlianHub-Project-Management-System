const mockAccess = { assigned: {}, seats: {} };

jest.mock('../Config/jwt', () => ({
    verifyCompanyMembership: async (uid, companyId) => (mockAccess.assigned[uid] || []).includes(companyId),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (dbName, { type, data }) => {
        const [query] = data;
        const seated = type === 'company_users' && query.status === 2 && (mockAccess.seats[dbName] || []).includes(String(query.userId));
        return seated ? { _id: 'seat' } : null;
    },
}));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('../Modules/LogTime/controllerV2', () => new Proxy({}, {
    get: (_target, key) => (typeof key === 'string' && key !== '__esModule' && key !== 'then'
        ? (req, res) => res.json({ reached: true, file: req.file ? req.file.path : null })
        : undefined),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => {
    const command = () => class { constructor(input) { this.input = input; } };
    return {
        S3Client: class { async send() { return {}; } },
        GetObjectCommand: command(),
        CreateBucketCommand: command(),
        PutObjectCommand: command(),
        DeleteObjectCommand: command(),
        ListObjectsV2Command: command(),
        CopyObjectCommand: command(),
        DeleteBucketCommand: command(),
        HeadObjectCommand: command(),
    };
});

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const hex = () => crypto.randomBytes(12).toString('hex');
const USER = hex();
const COMPANY_A = hex();
const COMPANY_B = hex();
const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');
const WASABI_TEMP = path.resolve('wasabiUploads');
const SCREENSHOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PROFILE_IMAGE = `${USER}_${hex()}.png`;

const tempFiles = () => (fs.existsSync(WASABI_TEMP) ? fs.readdirSync(WASABI_TEMP).sort() : []);
const trackerPath = () => `Project/${hex()}/Sprint/${hex()}/TimeLog/${hex()}/${Date.now()}.png`;

afterAll(() => {
    for (const dir of [COMPANY_A, COMPANY_B]) fs.rmSync(path.join(STORAGE_ROOT, dir), { recursive: true, force: true });
    fs.rmSync(path.join(STORAGE_ROOT, 'USER_PROFILES', PROFILE_IMAGE), { force: true });
});

beforeEach(() => {
    mockAccess.assigned = { [USER]: [COMPANY_A, COMPANY_B] };
    mockAccess.seats = { [COMPANY_A]: [USER], [COMPANY_B]: [USER] };
});

/* Same fields, in the same order, as TrackerController.ScreenShotCapture in time-tracker-app. */
function trackerForm({ companyId, filePath, fileFirst = false }) {
    const form = new FormData();
    const appendFile = () => form.append('file', new Blob([SCREENSHOT], { type: 'image/png' }), 'screenshot.png');
    if (fileFirst) appendFile();
    form.append('strokes', '[]');
    form.append('companyId', companyId);
    form.append('timeSheetId', hex());
    form.append('imageName', path.basename(filePath));
    form.append('prevscreenShot', String(Date.now()));
    form.append('memoName', 'qa capture');
    form.append('screenShotTime', String(Date.now()));
    form.append('key', '0');
    form.append('type', 'timesheets');
    form.append('projectId', hex());
    form.append('path', filePath);
    if (!fileFirst) appendFile();
    form.append('actionTime', String(Math.floor(Date.now() / 1000)));
    return form;
}

describe.each(['server', 'wasabi'])('time tracker captures on %s storage', (storageType) => {
    let server;
    let baseURL;

    beforeAll(async () => {
        const previous = process.env.STORAGE_TYPE;
        process.env.STORAGE_TYPE = storageType;
        let routes;
        jest.isolateModules(() => { routes = require('../Modules/LogTime/routes'); });
        process.env.STORAGE_TYPE = previous;

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.uid = USER;
            req.aud = `${COMPANY_A},${COMPANY_B}`;
            next();
        });
        routes.init(app);
        app.use((err, _req, res, _next) => res.status(500).json({ status: false, statusText: err.message }));
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    const capture = (companyHeader, fields, version = 'v4') => fetch(`${baseURL}/api/${version}/timeTracker/capture`, {
        method: 'POST',
        headers: { companyid: companyHeader },
        body: trackerForm(fields),
    });
    const nothingWritten = (bucket, filePath, tempBefore) => (storageType === 'server'
        ? !fs.existsSync(path.join(STORAGE_ROOT, bucket, filePath))
        : JSON.stringify(tempFiles()) === JSON.stringify(tempBefore));

    it.each(['v2', 'v3', 'v4'])('refuses a %s capture whose body names another company than the header, before writing', async (version) => {
        const filePath = trackerPath();
        const before = tempFiles();
        const res = await capture(COMPANY_A, { companyId: COMPANY_B, filePath }, version);
        expect(res.status).toBe(403);
        expect(nothingWritten(COMPANY_B, filePath, before)).toBe(true);
    });

    it('refuses the USER_PROFILES bucket, even for a name carrying the caller\'s id', async () => {
        const before = tempFiles();
        const res = await capture(COMPANY_A, { companyId: 'USER_PROFILES', filePath: PROFILE_IMAGE });
        expect(res.status).toBe(403);
        expect(nothingWritten('USER_PROFILES', PROFILE_IMAGE, before)).toBe(true);
    });

    it('refuses a member whose company seat is gone', async () => {
        mockAccess.seats[COMPANY_A] = [];
        const filePath = trackerPath();
        const before = tempFiles();
        const res = await capture(COMPANY_A, { companyId: COMPANY_A, filePath });
        expect(res.status).toBe(403);
        expect(nothingWritten(COMPANY_A, filePath, before)).toBe(true);
    });

    it('refuses company and path fields sent after the file', async () => {
        const filePath = trackerPath();
        const before = tempFiles();
        const res = await capture(COMPANY_A, { companyId: COMPANY_A, filePath, fileFirst: true });
        expect(res.status).toBe(403);
        expect(nothingWritten(COMPANY_A, filePath, before)).toBe(true);
    });

    it('refuses a base64 capture into another company', async () => {
        const res = await fetch(`${baseURL}/api/v2/timetracker/capture`, {
            method: 'POST',
            headers: { companyid: COMPANY_A, 'content-type': 'application/json' },
            body: JSON.stringify({ companyId: COMPANY_B, path: trackerPath(), file: SCREENSHOT.toString('base64') }),
        });
        expect(res.status).toBe(403);
        expect((await res.json()).reached).toBeUndefined();
    });

    it('accepts the tracker\'s capture form from an active member of the header company', async () => {
        const filePath = trackerPath();
        const res = await capture(COMPANY_A, { companyId: COMPANY_A, filePath });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.reached).toBe(true);
        if (storageType === 'server') {
            expect(fs.readFileSync(path.join(STORAGE_ROOT, COMPANY_A, filePath))).toEqual(SCREENSHOT);
        } else {
            expect(fs.readFileSync(body.file)).toEqual(SCREENSHOT);
            fs.rmSync(body.file, { force: true });
        }
    });
});
