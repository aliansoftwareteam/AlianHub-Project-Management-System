process.env.STORAGE_TYPE = 'server';

const mockDb = { sessions: {}, seats: {}, updates: [] };
const mockUploads = [];

jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: async () => true }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (dbName, { type, data }, method) => {
        const [query] = data;
        if (type === 'company_users') {
            if (query.status === 2) return (mockDb.seats[dbName] || []).includes(String(query.userId)) ? { _id: 'seat' } : null;
            return { isTrackerUser: true };
        }
        if (type === 'users') return { _id: query._id, Employee_Name: 'Someone' };
        if (method === 'findOne' && query && query._id) {
            const id = String(query._id && query._id.$in ? query._id.$in[0] : query._id);
            const session = mockDb.sessions[id];
            return session && session.companyId === dbName ? { _id: id, ...session } : null;
        }
        if (method === 'findOneAndUpdate') {
            mockDb.updates.push({ dbName, type, filter: query, update: data[1] });
            return { _id: query._id };
        }
        return null;
    },
}));
jest.mock('../common-storage/common-server.js', () => {
    const actual = jest.requireActual('../common-storage/common-server.js');
    const recordUpload = (companyId, fpath) => { mockUploads.push({ companyId, fpath }); return Promise.resolve([fpath]); };
    return { ...actual, handleFileUploadForTrackerSS: recordUpload, handleuploadMainFileForbase64Thumbnail: recordUpload };
});
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const hex = () => crypto.randomBytes(12).toString('hex');
const ME = hex();
const COLLEAGUE = hex();
const COMPANY = hex();
const OTHER_COMPANY = hex();
const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');
const WASABI_TEMP = path.resolve('wasabiUploads');
const SCREENSHOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const createdTemp = !fs.existsSync(WASABI_TEMP);

const trackerPath = () => `Project/${hex()}/Sprint/${hex()}/TimeLog/${hex()}/${Date.now()}.png`;
const addSession = (owner, companyId = COMPANY) => {
    const id = hex();
    mockDb.sessions[id] = { companyId, Loggeduser: owner, LogStartTime: Math.floor(Date.now() / 1000) - 600, ProjectId: hex(), TicketID: hex() };
    return id;
};

/* Same fields, in the same order, as TrackerController.ScreenShotCapture in time-tracker-app. */
function trackerForm(timeSheetId, filePath, type = 'timesheets') {
    const form = new FormData();
    form.append('strokes', '[]');
    form.append('companyId', COMPANY);
    form.append('timeSheetId', timeSheetId);
    form.append('imageName', path.basename(filePath));
    form.append('prevscreenShot', String(Date.now()));
    form.append('memoName', 'qa capture');
    form.append('screenShotTime', String(Date.now()));
    form.append('key', '0');
    form.append('type', type);
    form.append('projectId', hex());
    form.append('path', filePath);
    form.append('file', new Blob([SCREENSHOT], { type: 'image/png' }), 'screenshot.png');
    form.append('actionTime', String(Math.floor(Date.now() / 1000)));
    return form;
}

const base64Body = (timeSheetId, filePath, type = 'timesheets') => JSON.stringify({
    companyId: COMPANY,
    timeSheetId,
    path: filePath,
    file: `data:image/png;base64,${SCREENSHOT.toString('base64')}`,
    key: '0',
    imageName: path.basename(filePath),
    prevscreenShot: String(Date.now()),
    memoName: 'qa capture',
    screenShotTime: String(Date.now()),
    strokes: '[]',
    type,
});

let server;
let baseURL;

beforeAll(async () => {
    fs.mkdirSync(WASABI_TEMP, { recursive: true });
    const routes = require('../Modules/LogTime/routes');
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use((req, _res, next) => {
        req.uid = ME;
        req.aud = `${COMPANY},${OTHER_COMPANY}`;
        next();
    });
    routes.init(app);
    app.use((err, _req, res, _next) => res.status(500).json({ status: false, statusText: err.message }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    fs.rmSync(path.join(STORAGE_ROOT, COMPANY), { recursive: true, force: true });
    if (createdTemp) fs.rmSync(WASABI_TEMP, { recursive: true, force: true });
});

beforeEach(() => {
    mockDb.sessions = {};
    mockDb.seats = { [COMPANY]: [ME, COLLEAGUE], [OTHER_COMPANY]: [ME] };
    mockDb.updates = [];
    mockUploads.length = 0;
});

const capture = (version, timeSheetId, filePath, type) => (version === 'v2'
    ? fetch(`${baseURL}/api/v2/timetracker/capture`, {
        method: 'POST',
        headers: { companyid: COMPANY, 'content-type': 'application/json' },
        body: base64Body(timeSheetId, filePath, type),
    })
    : fetch(`${baseURL}/api/${version}/timetracker/capture`, {
        method: 'POST',
        headers: { companyid: COMPANY },
        body: trackerForm(timeSheetId, filePath, type),
    }));

const storedFile = (filePath) => fs.existsSync(path.join(STORAGE_ROOT, COMPANY, filePath));

describe.each(['v2', 'v3', 'v4'])('a %s tracker capture', (version) => {
    it('adds to the caller\'s own session', async () => {
        const timeSheetId = addSession(ME);
        const res = await capture(version, timeSheetId, trackerPath());

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: true });
        expect(mockDb.updates).toHaveLength(1);
        expect(String(mockDb.updates[0].filter._id)).toBe(timeSheetId);
        expect(mockUploads).toHaveLength(1);
    });

    it('is refused for a colleague\'s session in the same company, and writes nothing', async () => {
        const timeSheetId = addSession(COLLEAGUE);
        const filePath = trackerPath();
        const res = await capture(version, timeSheetId, filePath);

        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ status: false, statusText: 'You can only track your own time.' });
        expect(mockDb.updates).toHaveLength(0);
        expect(mockUploads).toHaveLength(0);
        expect(storedFile(filePath)).toBe(false);
    });

    it('is refused for the caller\'s own session held in another company', async () => {
        const timeSheetId = addSession(ME, OTHER_COMPANY);
        const filePath = trackerPath();
        const res = await capture(version, timeSheetId, filePath);

        expect(res.status).toBe(403);
        expect(mockDb.updates).toHaveLength(0);
        expect(mockUploads).toHaveLength(0);
        expect(storedFile(filePath)).toBe(false);
    });

    it('is refused when the request names a collection other than the timesheets, and writes nothing', async () => {
        const timeSheetId = addSession(ME);
        const filePath = trackerPath();
        const res = await capture(version, timeSheetId, filePath, 'projects');

        expect(res.status).toBe(403);
        expect(mockDb.updates).toHaveLength(0);
        expect(mockUploads).toHaveLength(0);
        expect(storedFile(filePath)).toBe(false);
    });

    it('is refused for a session id that does not exist', async () => {
        const filePath = trackerPath();
        const res = await capture(version, hex(), filePath);

        expect(res.status).toBe(403);
        expect(mockDb.updates).toHaveLength(0);
        expect(storedFile(filePath)).toBe(false);
    });
});
