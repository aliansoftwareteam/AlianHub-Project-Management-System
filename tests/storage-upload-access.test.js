jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { verifyCompanyMembership } = require('../Config/jwt');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const bucketAccess = require('../Modules/storage/bucketAccess');
const { upload, validatePath } = require('../Modules/storage/server/helpers/bucket.helper');

const hex = () => crypto.randomBytes(12).toString('hex');
const USER = hex();
const OTHER_USER = hex();
const COMPANY_A = hex();
const COMPANY_B = hex();
const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');

let assignCompany;
let activeSeats;
let users;

const mongoMatches = (value, condition) => (condition && condition.$regex !== undefined
    ? typeof value === 'string' && new RegExp(condition.$regex, condition.$options).test(value)
    : value === condition);

beforeEach(() => {
    assignCompany = { [USER]: [COMPANY_A] };
    activeSeats = { [COMPANY_A]: [USER] };
    users = {};
    verifyCompanyMembership.mockReset();
    verifyCompanyMembership.mockImplementation(async (uid, companyId) => (assignCompany[uid] || []).includes(companyId));
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (dbName, { type, data }) => {
        const [query] = data;
        if (type === 'company_users') {
            const seated = (activeSeats[dbName] || []).includes(String(query.userId));
            return seated && query.status === 2 ? { _id: hex() } : null;
        }
        if (type === 'buckets') return { id: query.id, rule: { isPrivate: true } };
        if (type === 'users') {
            const alternatives = query.$or || [{ Employee_profileImage: query.Employee_profileImage }];
            const excluded = query._id && query._id.$ne ? String(query._id.$ne) : null;
            const wanted = query._id && !query._id.$ne ? String(query._id) : null;
            const hit = Object.entries(users).find(([id, record]) => id !== excluded && (!wanted || id === wanted)
                && alternatives.some((fields) => Object.entries(fields).every(([field, condition]) => mongoMatches(record[field], condition))));
            return hit ? { _id: hit[0] } : null;
        }
        return null;
    });
});

afterAll(() => {
    for (const bucket of [COMPANY_A, COMPANY_B]) fs.rmSync(path.join(STORAGE_ROOT, bucket), { recursive: true, force: true });
});

function run(middleware, req) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ nextCalled: false, status: this.statusCode, body }); return this; },
            send(body) { return this.json(body); },
        };
        Promise.resolve(middleware(req, res, () => resolve({ nextCalled: true }))).catch((error) => resolve({ error }));
    });
}

describe('belongsToCompany', () => {
    it('refuses a user whose company_users seat is gone while users.AssignCompany still lists the company', async () => {
        activeSeats[COMPANY_A] = [];
        expect(await bucketAccess.belongsToCompany({ uid: USER, aud: COMPANY_A }, COMPANY_A)).toBe(false);
    });

    it('accepts a user with an active seat', async () => {
        expect(await bucketAccess.belongsToCompany({ uid: USER, aud: COMPANY_A }, COMPANY_A)).toBe(true);
    });
});

describe('profile image ownership', () => {
    it('lets a user write only a flat name prefixed with their own id', () => {
        expect(bucketAccess.mayWriteProfileImage(USER, `${USER}_1_avatar.png`)).toBe(true);
        expect(bucketAccess.mayWriteProfileImage(USER, `${OTHER_USER}_1_avatar.png`)).toBe(false);
        expect(bucketAccess.mayWriteProfileImage(USER, '1_avatar.png')).toBe(false);
        expect(bucketAccess.mayWriteProfileImage(USER, `folder/${USER}_1_avatar.png`)).toBe(false);
        expect(bucketAccess.mayWriteProfileImage('', '_1_avatar.png')).toBe(false);
    });

    it('lets a user remove their own legacy image stored on their user record', async () => {
        users[USER] = { Employee_profileImage: '171_old.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_old.png')).toBe(true);
        expect(await bucketAccess.mayRemoveProfileImage(USER, `${USER}_2_new.png`)).toBe(true);
    });

    it('refuses a legacy image another user still references, or one of its thumbnails', async () => {
        users[USER] = { Employee_profileImage: '171_old.png' };
        users[OTHER_USER] = { Employee_profileImage: '171_old.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_old.png')).toBe(false);

        users[USER] = { Employee_profileImage: '171_old-64x64.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_old-64x64.png')).toBe(false);
    });

    it('refuses a legacy image another user holds under different letter case, since the disk may ignore case', async () => {
        users[OTHER_USER] = { Employee_profileImage: '171_photo.png' };
        users[USER] = { Employee_profileImage: '171_PHOTO.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_PHOTO.png')).toBe(false);

        users[USER] = { Employee_profileImage: '171_PHOTO-64X64.PNG' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_PHOTO-64X64.PNG')).toBe(false);
    });

    it('matches other users\' images literally, not as a pattern', async () => {
        users[OTHER_USER] = { Employee_profileImage: '171_photoXpng' };
        users[USER] = { Employee_profileImage: '171_photo.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_photo.png')).toBe(true);
    });

    it('refuses another user\'s image and anything in a sub folder', async () => {
        users[OTHER_USER] = { Employee_profileImage: '171_theirs.png' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, '171_theirs.png')).toBe(false);
        expect(await bucketAccess.mayRemoveProfileImage(USER, `${OTHER_USER}_2_theirs.png`)).toBe(false);
        users[USER] = { Employee_profileImage: 'InvoiceAndCreditNotes/CreditNotes/x.pdf' };
        expect(await bucketAccess.mayRemoveProfileImage(USER, 'InvoiceAndCreditNotes/CreditNotes/x.pdf')).toBe(false);
    });
});

describe('requireBucketWrite and requireBucketRemoval', () => {
    const write = bucketAccess.requireBucketWrite(bucketAccess.bodyField('companyId'), bucketAccess.bodyField('path'));
    const removal = bucketAccess.requireBucketRemoval(bucketAccess.bucketIdParam, bucketAccess.queryField('filepath'));

    it('binds USER_PROFILES writes to the caller', async () => {
        const own = await run(write, { uid: USER, aud: COMPANY_A, body: { companyId: 'USER_PROFILES', path: `${USER}_1_a.png` } });
        expect(own.nextCalled).toBe(true);
        const other = await run(write, { uid: USER, aud: COMPANY_A, body: { companyId: 'USER_PROFILES', path: `${OTHER_USER}_1_a.png` } });
        expect(other).toMatchObject({ nextCalled: false, status: 403 });
    });

    it('binds USER_PROFILES removals to the caller', async () => {
        users[OTHER_USER] = { Employee_profileImage: '171_theirs.png' };
        const other = await run(removal, { uid: USER, aud: COMPANY_A, params: { bucketId: 'USER_PROFILES' }, query: { filepath: '171_theirs.png' } });
        expect(other).toMatchObject({ nextCalled: false, status: 403 });
        const own = await run(removal, { uid: USER, aud: COMPANY_A, params: { bucketId: 'USER_PROFILES' }, query: { filepath: `${USER}_1_a.png` } });
        expect(own.nextCalled).toBe(true);
    });

    it('still checks company membership for company buckets', async () => {
        expect((await run(write, { uid: USER, aud: COMPANY_A, body: { companyId: COMPANY_A, path: 'a.png' } })).nextCalled).toBe(true);
        expect((await run(write, { uid: USER, aud: `${COMPANY_A},${COMPANY_B}`, body: { companyId: COMPANY_B, path: 'a.png' } })).status).toBe(403);
    });
});

describe('POST /api/v1/storage/uploadFile on server storage', () => {
    let server;
    let baseURL;

    beforeAll(async () => {
        const app = express();
        app.use((req, _res, next) => {
            req.uid = req.headers['x-uid'];
            req.aud = req.headers['x-aud'];
            next();
        });
        app.post('/upload', upload.single('file'), validatePath, (req, res) => res.status(200).send({ status: true, statusText: req.body.path }));
        app.use((err, _req, res, _next) => res.status(500).send({ status: false, statusText: err.message }));
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    const send = ({ uid = USER, aud = COMPANY_A, companyId, filePath }) => {
        const form = new FormData();
        form.append('companyId', companyId);
        form.append('path', filePath);
        form.append('file', new Blob(['f35d upload body']), 'note.txt');
        return fetch(`${baseURL}/upload`, { method: 'POST', headers: { 'x-uid': uid, 'x-aud': aud }, body: form });
    };

    it('refuses another company before a byte is written, even with a stale token audience', async () => {
        const filePath = `qa/${hex()}.txt`;
        const res = await send({ aud: `${COMPANY_A},${COMPANY_B}`, companyId: COMPANY_B, filePath });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_B))).toBe(false);
    });

    it('refuses a member whose seat is gone and leaves no file behind', async () => {
        activeSeats[COMPANY_A] = [];
        const filePath = `qa/${hex()}.txt`;
        const res = await send({ companyId: COMPANY_A, filePath });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_A, filePath))).toBe(false);
    });

    it('refuses writing another user\'s profile image and leaves no file behind', async () => {
        const filePath = `${OTHER_USER}_${hex()}.txt`;
        const res = await send({ companyId: 'USER_PROFILES', filePath });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, 'USER_PROFILES', filePath))).toBe(false);
    });

    it('stores an upload from an active member of the company', async () => {
        const filePath = `qa/${hex()}.txt`;
        const res = await send({ companyId: COMPANY_A, filePath });
        expect(res.status).toBe(200);
        expect(fs.readFileSync(path.join(STORAGE_ROOT, COMPANY_A, filePath), 'utf8')).toBe('f35d upload body');
    });
});
