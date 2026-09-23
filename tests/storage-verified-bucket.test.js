process.env.STORAGE_TYPE = 'wasabi';

jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'https://signed.example/object') }));
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
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { verifyCompanyMembership } = require('../Config/jwt');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const wasabi = require('../Modules/storage/wasabi/controller');
const server = require('../Modules/storage/server/controller');

const hex = () => crypto.randomBytes(12).toString('hex');
const USER = hex();
const COMPANY_A = hex();
const COMPANY_B = hex();

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.set = () => r;
    return r;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterAll(() => {
    for (const bucket of [COMPANY_A, COMPANY_B]) fs.rmSync(path.resolve(__dirname, '..', 'storage', bucket), { recursive: true, force: true });
});

beforeEach(() => {
    s3Send.mockClear();
    getSignedUrl.mockClear();
    verifyCompanyMembership.mockReset();
    verifyCompanyMembership.mockImplementation(async (uid, companyId) => uid === USER && (companyId === COMPANY_A || companyId === COMPANY_B));
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (dbName, { type, data }) => {
        if (type === 'company_users') return dbName === COMPANY_A && String(data[0].userId) === USER ? { _id: hex() } : null;
        return null;
    });
});

describe('POST /api/v1/wasabi/deleteFile', () => {
    let listening;
    let baseURL;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.uid = USER;
            req.aud = `${COMPANY_A},${COMPANY_B}`;
            next();
        });
        require('../Modules/storage/wasabi/routes').init(app);
        await new Promise((resolve) => { listening = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${listening.address().port}`;
    });

    afterAll(() => new Promise((resolve) => { listening.closeAllConnections(); listening.close(resolve); }));

    const remove = (body) => fetch(`${baseURL}/api/v1/wasabi/deleteFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', companyid: COMPANY_A },
        body: JSON.stringify(body),
    });

    it('refuses a company still in the token audience where the caller holds no seat', async () => {
        const r = await remove({ companyId: COMPANY_B, path: 'qa/note.txt' });

        expect(r.status).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('deletes from the bucket of a company the caller is an active member of', async () => {
        const r = await remove({ companyId: COMPANY_A, path: 'qa/note.txt' });

        expect(r.status).toBe(200);
        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(s3Send.mock.calls[0][0].input.Bucket).toBe(COMPANY_A);
    });
});

describe('storage handlers use the bucket the access check verified, never the body', () => {
    const unverified = (body) => ({ uid: USER, aud: `${COMPANY_A},${COMPANY_B}`, headers: {}, body });

    it('wasabi getPresignedUrl refuses a body bucket nothing verified', async () => {
        const r = res();
        await wasabi.getPresignedUrl(unverified({ companyId: COMPANY_A, path: 'qa/note.txt' }), r);

        expect(r.code).toBe(403);
        expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('wasabi getPresignedUrl signs for the verified bucket', async () => {
        const r = res();
        await wasabi.getPresignedUrl({ ...unverified({ companyId: COMPANY_A, path: 'qa/note.txt' }), storageBucket: COMPANY_A }, r);

        expect(r.body).toMatchObject({ status: true });
        expect(getSignedUrl.mock.calls[0][1].input.Bucket).toBe(COMPANY_A);
    });

    it('wasabi deleteFileWasabi refuses a body bucket nothing verified', async () => {
        const r = res();
        await wasabi.deleteFileWasabi(unverified({ companyId: COMPANY_A, path: 'qa/note.txt' }), r);

        expect(r.code).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('wasabi uploadFileWasabi refuses a body bucket nothing verified', async () => {
        const r = res();
        await wasabi.uploadFileWasabi({ ...unverified({ companyId: COMPANY_A, path: 'qa/note.txt' }), file: { path: '/nonexistent/ts7-note.txt' } }, r);
        await settle();

        expect(r.code).toBe(403);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('server uploadFileOnStorage refuses a body bucket nothing verified', async () => {
        const r = res();
        await server.uploadFileOnStorage({ ...unverified({ companyId: COMPANY_A, path: 'qa/note.txt', key: 'none' }), file: { path: '/nonexistent/ts7-note.txt' } }, r);

        expect(r.code).toBe(403);
    });

    it('server uploadBase64FileOnServerStorage refuses a body bucket nothing verified', async () => {
        const r = res();
        server.uploadBase64FileOnServerStorage(unverified({ companyId: COMPANY_A, path: 'qa/a.png', base64String: 'aGk=' }), r);
        await settle();

        expect(r.code).toBe(403);
    });
});
