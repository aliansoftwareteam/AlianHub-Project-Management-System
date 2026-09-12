jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn() }));

const crypto = require('node:crypto');
const { verifyCompanyMembership } = require('../Config/jwt');
const { getRoleType } = require('../Config/permissionGuard');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, ROLE_GUEST } = require('../Config/roleTypes');
const bucketAccess = require('../Modules/storage/bucketAccess');

const hex = () => crypto.randomBytes(12).toString('hex');
const COMPANY_A = hex();
const COMPANY_B = hex();
const OWNER_OF_A = hex();
const COLLEAGUE = hex();
const OUTSIDER = hex();

const AVATAR = `${OWNER_OF_A}_17_photo.png`;
const AVATAR_THUMBNAIL = `${OWNER_OF_A}_17_photo-35x35.png`;
const LEGACY_AVATAR = '171_photo.png';
const CREDIT_NOTE = `InvoiceAndCreditNotes/CreditNotes/${COMPANY_A}/inv-9.pdf`;

let assignCompany;
let activeSeats;
let roles;
let users;

const matches = (value, condition) => (condition && condition.$regex !== undefined
    ? typeof value === 'string' && new RegExp(condition.$regex, condition.$options).test(value)
    : value === condition);

beforeEach(() => {
    myCache.flushAll();
    assignCompany = {
        [OWNER_OF_A]: [COMPANY_A],
        [COLLEAGUE]: [COMPANY_A],
        [OUTSIDER]: [COMPANY_B],
    };
    activeSeats = { [COMPANY_A]: [OWNER_OF_A, COLLEAGUE], [COMPANY_B]: [OUTSIDER] };
    roles = { [COMPANY_A]: { [OWNER_OF_A]: ROLE_OWNER, [COLLEAGUE]: ROLE_MEMBER }, [COMPANY_B]: { [OUTSIDER]: ROLE_OWNER } };
    users = {};
    verifyCompanyMembership.mockReset();
    verifyCompanyMembership.mockImplementation(async (uid, companyId) => (assignCompany[uid] || []).includes(companyId));
    getRoleType.mockReset();
    getRoleType.mockImplementation(async (companyId, uid) => {
        const role = (roles[companyId] || {})[uid];
        return role === undefined ? null : role;
    });
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (dbName, { type, data }) => {
        const [query] = data;
        if (type === 'company_users') {
            const seated = (activeSeats[dbName] || []).includes(String(query.userId));
            return seated && query.status === 2 ? { _id: hex() } : null;
        }
        if (type === 'users') {
            const wanted = query._id ? String(query._id) : null;
            if (wanted) return assignCompany[wanted] ? { _id: wanted, AssignCompany: assignCompany[wanted] } : null;
            const hit = Object.entries(users).find(([, record]) => (query.$or || []).some(
                (fields) => Object.entries(fields).every(([field, condition]) => matches(record[field], condition)),
            ));
            return hit ? { _id: hit[0] } : null;
        }
        return null;
    });
});

const session = (uid) => ({ uid, aud: (assignCompany[uid] || []).join(',') });

describe('reading an avatar under USER_PROFILES', () => {
    it('refuses a signed-in user who shares no company with the image owner', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(OUTSIDER), AVATAR)).toBe(false);
        expect(await bucketAccess.mayReadProfileImage(session(OUTSIDER), AVATAR_THUMBNAIL)).toBe(false);
    });

    it('lets a colleague in the same company read it, thumbnails included', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), AVATAR)).toBe(true);
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), AVATAR_THUMBNAIL)).toBe(true);
    });

    it('lets the owner read their own image whatever company they are in', async () => {
        assignCompany[OWNER_OF_A] = [];
        activeSeats[COMPANY_A] = [COLLEAGUE];
        expect(await bucketAccess.mayReadProfileImage(session(OWNER_OF_A), AVATAR)).toBe(true);
    });

    it('refuses a member whose seat is gone while the token audience still names the company', async () => {
        activeSeats[COMPANY_A] = [OWNER_OF_A];
        expect(await bucketAccess.mayReadProfileImage({ uid: COLLEAGUE, aud: COMPANY_A }, AVATAR)).toBe(false);
    });

    it('resolves a legacy name through the user record that points at it', async () => {
        users[OWNER_OF_A] = { Employee_profileImage: LEGACY_AVATAR };
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), LEGACY_AVATAR)).toBe(true);
        myCache.flushAll();
        expect(await bucketAccess.mayReadProfileImage(session(OUTSIDER), LEGACY_AVATAR)).toBe(false);
    });

    it('refuses a name no user holds, and anything outside the flat profile bucket', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), LEGACY_AVATAR)).toBe(false);
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), `../${COMPANY_B}/secret.png`)).toBe(false);
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), 'thumbnails/photo.png')).toBe(false);
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), '')).toBe(false);
    });
});

describe('reading a credit note under USER_PROFILES', () => {
    it('refuses a member and a guest of the company it belongs to', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), CREDIT_NOTE)).toBe(false);
        roles[COMPANY_A][COLLEAGUE] = ROLE_GUEST;
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), CREDIT_NOTE)).toBe(false);
    });

    it('lets an owner and an admin of that company read it', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(OWNER_OF_A), CREDIT_NOTE)).toBe(true);
        roles[COMPANY_A][COLLEAGUE] = ROLE_ADMIN;
        expect(await bucketAccess.mayReadProfileImage(session(COLLEAGUE), CREDIT_NOTE)).toBe(true);
    });

    it('refuses an owner of another company, whose own role says nothing about this one', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(OUTSIDER), CREDIT_NOTE)).toBe(false);
    });

    it('refuses a credit-note path that names no company', async () => {
        expect(await bucketAccess.mayReadProfileImage(session(OWNER_OF_A), 'InvoiceAndCreditNotes/CreditNotes/inv-9.pdf')).toBe(false);
    });
});

describe('the read guards on the storage routes', () => {
    const run = (middleware, req) => new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ nextCalled: false, status: this.statusCode, body }); return this; },
            send(body) { return this.json(body); },
        };
        Promise.resolve(middleware(req, res, () => resolve({ nextCalled: true }))).catch((error) => resolve({ error }));
    });

    const signedUrl = bucketAccess.requireBucketRead(bucketAccess.bucketIdParam, bucketAccess.queryField('filepath'));
    const profileRead = bucketAccess.requireProfileImageRead(bucketAccess.bodyField('path'));

    it('answers 401 to a request with no verified session', async () => {
        expect(await run(profileRead, { body: { path: AVATAR } })).toMatchObject({ nextCalled: false, status: 401 });
    });

    it('refuses signing another company\'s member image and lets a colleague through', async () => {
        const outsider = await run(signedUrl, { ...session(OUTSIDER), params: { bucketId: 'USER_PROFILES' }, query: { filepath: AVATAR } });
        expect(outsider).toMatchObject({ nextCalled: false, status: 403 });
        const colleague = await run(signedUrl, { ...session(COLLEAGUE), params: { bucketId: 'USER_PROFILES' }, query: { filepath: AVATAR } });
        expect(colleague.nextCalled).toBe(true);
    });

    it('refuses a credit note for a member and allows it for an owner', async () => {
        expect((await run(profileRead, { ...session(COLLEAGUE), body: { path: CREDIT_NOTE } })).status).toBe(403);
        expect((await run(profileRead, { ...session(OWNER_OF_A), body: { path: CREDIT_NOTE } })).nextCalled).toBe(true);
    });

    it('still checks company membership for company buckets', async () => {
        const own = await run(signedUrl, { ...session(COLLEAGUE), params: { bucketId: COMPANY_A }, query: { filepath: 'task/a.png' } });
        expect(own.nextCalled).toBe(true);
        const other = await run(signedUrl, { uid: COLLEAGUE, aud: `${COMPANY_A},${COMPANY_B}`, params: { bucketId: COMPANY_B }, query: { filepath: 'task/a.png' } });
        expect(other.status).toBe(403);
    });
});
