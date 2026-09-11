process.env.STORAGE_TYPE = 'wasabi';

jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => {
    const send = jest.fn(async () => ({}));
    const command = (name) => class { constructor(input) { this.name = name; this.input = input; } };
    return {
        __send: send,
        S3Client: class { send(cmd) { return send(cmd); } },
        GetObjectCommand: command('GetObject'),
        CreateBucketCommand: command('CreateBucket'),
        PutObjectCommand: command('PutObject'),
        DeleteObjectCommand: command('DeleteObject'),
        ListObjectsV2Command: command('ListObjectsV2'),
        CopyObjectCommand: command('CopyObject'),
        DeleteBucketCommand: command('DeleteBucket'),
        HeadObjectCommand: command('HeadObject'),
    };
});

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { __send: s3Send } = require('@aws-sdk/client-s3');
const { verifyCompanyMembership } = require('../Config/jwt');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

const hex = () => crypto.randomBytes(12).toString('hex');
const USER = hex();
const OTHER_USER = hex();
const COMPANY_A = hex();
const COMPANY_B = hex();
const TEMP_DIR = path.resolve('wasabiUploads');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let server;
let baseURL;
const tempFiles = () => (fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR).sort() : []);

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.uid = USER;
        req.aud = `${COMPANY_A},${COMPANY_B}`;
        next();
    });
    require('../Modules/storage/wasabi/routes').init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    s3Send.mockClear();
    verifyCompanyMembership.mockReset();
    verifyCompanyMembership.mockImplementation(async (uid, companyId) => uid === USER && companyId === COMPANY_A);
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (dbName, { type, data }) => {
        if (type === 'company_users') return dbName === COMPANY_A && String(data[0].userId) === USER ? { _id: hex() } : null;
        return null;
    });
});

const multipart = (fields) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob(['f35d wasabi body']), 'note.txt');
    return fetch(`${baseURL}/api/v1/wasabi/uploadFile`, { method: 'POST', body: form });
};
const base64 = (body) => fetch(`${baseURL}/api/v1/wasabi/uploadFile_64`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

describe('POST /api/v1/wasabi/uploadFile', () => {
    it('refuses another company still in the token audience before anything reaches disk or the bucket', async () => {
        const before = tempFiles();
        const res = await multipart({ companyId: COMPANY_B, path: 'qa/note.txt' });
        expect(res.status).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
        expect(tempFiles()).toEqual(before);
    });

    it('refuses writing another user\'s profile image', async () => {
        const before = tempFiles();
        const res = await multipart({ companyId: COMPANY_A, isUserProfile: 'true', path: `${OTHER_USER}_1_a.png` });
        expect(res.status).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
        expect(tempFiles()).toEqual(before);
    });

    it('uploads for an active member of the company', async () => {
        const res = await multipart({ companyId: COMPANY_A, path: 'qa/note.txt' });
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe(true);
        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(s3Send.mock.calls[0][0].input.Bucket).toBe(COMPANY_A);
    });
});

describe('POST /api/v1/wasabi/uploadFile_64', () => {
    it('refuses another company', async () => {
        const res = await base64({ companyId: COMPANY_B, path: 'qa/a.png', base64String: PNG });
        expect(res.status).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('refuses writing another user\'s profile image', async () => {
        const res = await base64({ isUserProfile: true, path: `${OTHER_USER}_1_a.png`, base64String: PNG, key: 'userProfile' });
        expect(res.status).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('uploads the caller\'s own profile image', async () => {
        const res = await base64({ isUserProfile: true, path: `${USER}_1_a.png`, base64String: PNG });
        expect(res.status).toBe(200);
        expect(s3Send).toHaveBeenCalled();
    });
});
