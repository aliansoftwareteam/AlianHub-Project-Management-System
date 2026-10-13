process.env.STORAGE_TYPE = 'server';

const fs = require('fs');
const verified = require('./fixtures/verifiedRequest');
const mockCrud = jest.fn();
const mockUpload = jest.fn();
const mockUploadFromDisk = jest.fn();
const mockProjectTime = jest.fn();
const mockRemaining = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({}));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({
    handleuploadMainFileForbase64Thumbnail: (...a) => mockUpload(...a),
    handleFileUploadForTrackerSS: (...a) => mockUploadFromDisk(...a),
}));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: (...a) => mockProjectTime(...a),
    updateRemainingTime: (...a) => mockRemaining(...a),
}));

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const capture = require('../Modules/LogTime/controllerV2/capture');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const SHEET = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000f01';
const PROJECT = '6f0000000000000000000b01';
const NOW_SECONDS = 1790000000;
const START_SECONDS = NOW_SECONDS - 600;

const variants = {
    captureTimetracker: { name: 'v1 (base64 body)', handler: capture.captureTimetracker, uploader: mockUpload, fileMissing: (b) => { delete b.file; }, withFile: (b) => { b.file = 'data:image/png;base64,AAAA'; return {}; } },
    captureTimetracker2: { name: 'v2 (multipart)', handler: capture.captureTimetracker2, uploader: mockUploadFromDisk, fileMissing: () => {}, withFile: () => ({ file: { path: '/tmp/up.png' } }) },
    captureTimetracker3: { name: 'v3 (multipart, tracker users)', handler: capture.captureTimetracker3, uploader: mockUploadFromDisk, fileMissing: () => {}, withFile: () => ({ file: { path: '/tmp/up.png' } }) },
};

const baseBody = () => ({
    path: 'shots/p1',
    timeSheetId: SHEET,
    key: 'k1',
    imageName: 'shot.png',
    prevscreenShot: '',
    memoName: 'memo',
    screenShotTime: '10:00',
    strokes: JSON.stringify([{ x: 1 }]),
});

const sheet = (over = {}) => ({ _id: SHEET, Loggeduser: ME, ProjectId: PROJECT, TicketID: TASK, LogStartTime: START_SECONDS, ...over });

const call = async (name, { body = baseBody(), noFile = false, uid = ME, headers = { companyid: C }, aud = headers.companyid } = {}) => {
    const v = variants[name];
    const extra = v.withFile(body);
    if (noFile) {
        v.fileMissing(body);
        delete extra.file;
    }
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    v.handler(verified({ headers, body, query: {}, params: {}, uid, aud, ...extra }), r);
    for (let i = 0; i < 50 && r.body === null; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return r;
};

const updateCalls = () => mockCrud.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate');

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000);
    jest.spyOn(fs, 'writeFile').mockImplementation((p, data, cb) => cb(null));
    jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => cb(null));
    mockUpload.mockResolvedValue(['stored-v1.png']);
    mockUploadFromDisk.mockResolvedValue(['stored.png']);
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (type === SCHEMA_TYPE.COMPANY_USERS) return { isTrackerUser: 1 };
        if (method === 'findOne') return sheet();
        return { acknowledged: true };
    });
});

afterEach(() => jest.restoreAllMocks());

describe.each(Object.keys(variants))('%s', (name) => {
    const v = variants[name];

    it('stores the screenshot on the time log and answers success', async () => {
        const r = await call(name);

        expect(r.body).toEqual({ status: true, statusText: 'Data Update Succesfully' });
        const [update] = updateCalls();
        expect(update[0]).toBe(C);
        expect(update[1].type).toBe(SCHEMA_TYPE.TIMESHEET);
        const [filter, change] = update[1].data;
        expect(filter).toEqual({ _id: SHEET });
        expect(change.$push.trackShots).toEqual({
            key: 'k1', name: 'shot.png', prevscreenShot: '', screenShotTime: '10:00', image: expect.stringMatching(/^stored/), memoName: 'memo', strokes: [{ x: 1 }],
        });
    });

    it('moves the log end and tracker start to now and measures the duration in minutes', async () => {
        await call(name);
        const { $set } = updateCalls()[0][1].data[1];
        expect($set.LogEndTime).toBe(NOW_SECONDS);
        expect($set.startTimeTracker).toBe(NOW_SECONDS);
        expect($set.LogTimeDuration).toBe(10);
    });

    it('uploads the image into the caller company bucket under the given path, as a trackshot', async () => {
        await call(name);
        expect(v.uploader).toHaveBeenCalledTimes(1);
        const args = v.uploader.mock.calls[0];
        expect(args[0]).toBe(C);
        expect(args[1]).toBe('shots/p1');
        expect(args[args.length - 1]).toBe('trackshot');
    });

    it('looks the time log up in the caller company by id', async () => {
        await call(name);
        const lookup = mockCrud.mock.calls.find(([, { type }]) => type === SCHEMA_TYPE.TIMESHEET);
        expect(lookup[0]).toBe(C);
        expect(lookup[1].data[0]).toEqual({ _id: { $in: [SHEET] } });
        expect(lookup[2]).toBe('findOne');
        mockCrud.mock.calls.forEach(([companyId]) => expect(companyId).toBe(C));
    });

    it('refreshes the project and task time of the logged user once the shot is saved', async () => {
        await call(name);
        expect(mockProjectTime).toHaveBeenCalledWith(C, PROJECT, false, NOW_SECONDS, ME, TASK, SHEET, true);
        expect(mockRemaining).toHaveBeenCalledWith(C, TASK);
    });

    it.each([
        ['path', 'path is required'],
        ['timeSheetId', 'timeSheetId is required'],
        ['key', 'key is required'],
        ['imageName', 'imageName is required'],
        ['memoName', 'memoName is required'],
        ['screenShotTime', 'screenShotTime is required'],
        ['strokes', 'strokes is required'],
    ])('refuses a body without %s and uploads and writes nothing', async (field, text) => {
        const body = baseBody();
        delete body[field];
        const r = await call(name, { body });
        expect(r.body).toEqual({ status: false, statusText: text });
        expect(v.uploader).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a body without prevscreenShot, but accepts an empty one', async () => {
        const body = baseBody();
        delete body.prevscreenShot;
        const r = await call(name, { body });
        expect(r.body).toEqual({ status: false, statusText: 'prevscreenShot is required' });
        expect((await call(name)).body.status).toBe(true);
    });

    it('refuses a request without the screenshot itself', async () => {
        const r = await call(name, { noFile: true });
        expect(r.body).toEqual({ status: false, statusText: 'screenShot is required' });
        expect(v.uploader).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers a failure and writes nothing when the strokes are not valid JSON', async () => {
        const body = baseBody();
        body.strokes = '{not json';
        const r = await call(name, { body });
        expect(r.body.status).toBe(false);
        expect(updateCalls()).toHaveLength(0);
        expect(mockProjectTime).not.toHaveBeenCalled();
    });

    it('answers a failure and writes nothing when the time log does not exist', async () => {
        mockCrud.mockImplementation(async () => null);
        const r = await call(name);
        expect(r.body.status).toBe(false);
        expect(updateCalls()).toHaveLength(0);
        expect(mockProjectTime).not.toHaveBeenCalled();
    });

    it('answers the failure and does not refresh times when the update fails', async () => {
        mockCrud.mockImplementation(async (companyId, { type }, method) => {
            if (method === 'findOneAndUpdate') throw new Error('write failed');
            if (type === SCHEMA_TYPE.COMPANY_USERS) return { isTrackerUser: 1 };
            return sheet();
        });
        const r = await call(name);
        expect(r.body).toEqual({ status: false, message: 'write failed' });
        expect(mockProjectTime).not.toHaveBeenCalled();
        expect(mockRemaining).not.toHaveBeenCalled();
    });

    it('answers a failure and touches no time log when the upload fails', async () => {
        v.uploader.mockRejectedValue(new Error('bucket down'));
        const r = await call(name);
        expect(r.body.status).toBe(false);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 403 to a body that names another company and does nothing', async () => {
        const r = await call(name, { body: { ...baseBody(), companyId: OTHER_COMPANY } });
        expect(r.code).toBe(403);
        expect(v.uploader).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 403 when the token does not hold the header company and does nothing', async () => {
        const r = await call(name, { aud: OTHER_COMPANY });
        expect(r.code).toBe(403);
        expect(v.uploader).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 403 when there is no company header and does nothing', async () => {
        const r = await call(name, { headers: {}, aud: C });
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('overwrites a company id in the body with the verified one', async () => {
        const body = { ...baseBody(), companyId: C };
        await call(name, { body });
        expect(mockCrud.mock.calls.every(([companyId]) => companyId === C)).toBe(true);
    });
});

describe('captureTimetracker (v1) file handling', () => {
    it('saves the decoded image to a temporary file, then removes it after the upload', async () => {
        await call('captureTimetracker');
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        const [filePath, buffer] = fs.writeFile.mock.calls[0];
        expect(filePath).toMatch(/^wasabiUploads\/file_\d+\.png$/);
        expect(buffer).toEqual(Buffer.from('AAAA', 'base64'));
        expect(fs.unlink).toHaveBeenCalledWith(filePath, expect.any(Function));
    });

    it('answers the file error and uploads nothing when the temporary file cannot be written', async () => {
        fs.writeFile.mockImplementation((p, d, cb) => cb(new Error('disk full')));
        const r = await call('captureTimetracker');
        expect(r.body).toEqual({ status: false, statusText: 'Error file create:Error: disk full' });
        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('still answers success when the temporary file cannot be removed, and logs it', async () => {
        fs.unlink.mockImplementation((p, cb) => cb(new Error('busy')));
        const r = await call('captureTimetracker');
        expect(r.body.status).toBe(true);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('busy'));
    });

    it('answers that no time log was found for an unknown id', async () => {
        mockCrud.mockImplementation(async () => null);
        const r = await call('captureTimetracker');
        expect(r.body).toEqual({ status: false, statusText: 'No Data found for given timeSheet id' });
    });

    it('answers a plain error when the upload fails', async () => {
        mockUpload.mockRejectedValue(new Error('bucket down'));
        const r = await call('captureTimetracker');
        expect(r.body).toEqual({ status: false, statusText: 'error' });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('bucket down'));
    });
});

describe.each(['captureTimetracker2', 'captureTimetracker3'])('%s upload source', (name) => {
    it('uploads the multipart file from its path on disk', async () => {
        await call(name);
        const [, , diskPath, flag, file] = mockUploadFromDisk.mock.calls[0];
        expect(diskPath).toBe('/tmp/up.png');
        expect(flag).toBe(false);
        expect(file).toEqual({ path: '/tmp/up.png' });
    });

    it('answers the upload error as it is when the upload fails', async () => {
        mockUploadFromDisk.mockRejectedValue('bucket down');
        const r = await call(name);
        expect(r.body).toEqual({ status: false, statusText: 'bucket down' });
    });
});

describe('captureTimetracker3 tracker users', () => {
    it('asks whether the logged user is a tracker user in the caller company', async () => {
        await call('captureTimetracker3');
        const lookup = mockCrud.mock.calls.find(([, { type }]) => type === SCHEMA_TYPE.COMPANY_USERS);
        expect(lookup[0]).toBe(C);
        expect(lookup[1].data).toEqual([{ userId: ME }, { isTrackerUser: 1, _id: 0 }]);
        expect(lookup[2]).toBe('findOne');
    });

    it('refuses a user who is not a tracker user and writes nothing', async () => {
        mockCrud.mockImplementation(async (companyId, { type }) => (type === SCHEMA_TYPE.COMPANY_USERS ? { isTrackerUser: 0 } : sheet()));
        const r = await call('captureTimetracker3');
        expect(r.body).toEqual({ status: false, isPermissionDenied: true, message: 'Permisson Denied' });
        expect(updateCalls()).toHaveLength(0);
        expect(mockProjectTime).not.toHaveBeenCalled();
    });

    it('answers a failure and writes nothing when the user is not in the company at all', async () => {
        mockCrud.mockImplementation(async (companyId, { type }) => (type === SCHEMA_TYPE.COMPANY_USERS ? null : sheet()));
        const r = await call('captureTimetracker3');
        expect(r.body.status).toBe(false);
        expect(updateCalls()).toHaveLength(0);
    });

    it('answers the lookup error message when the user lookup fails', async () => {
        mockCrud.mockImplementation(async (companyId, { type }) => {
            if (type === SCHEMA_TYPE.COMPANY_USERS) throw new Error('lookup failed');
            return sheet();
        });
        const r = await call('captureTimetracker3');
        expect(r.body).toEqual({ status: false, message: 'lookup failed' });
    });

    it('ends the log at the reported action time when told to consider it', async () => {
        const actionTime = START_SECONDS + 300;
        await call('captureTimetracker3', { body: { ...baseBody(), considerActionTime: true, actionTime } });
        const { $set } = updateCalls()[0][1].data[1];
        expect($set.LogEndTime).toBe(actionTime);
        expect($set.startTimeTracker).toBe(actionTime);
        expect($set.LogTimeDuration).toBe(5);
    });

    it('ignores the action time unless told to consider it', async () => {
        await call('captureTimetracker3', { body: { ...baseBody(), actionTime: START_SECONDS + 300 } });
        expect(updateCalls()[0][1].data[1].$set.LogEndTime).toBe(NOW_SECONDS);
    });
});
