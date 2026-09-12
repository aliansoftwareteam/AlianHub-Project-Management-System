jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => ({ _id: '64b1f0c2a1b2c3d4e5f607bb' })) }));

const { verifyCompanyMembership } = require('../Config/jwt');
const { requireOwnBucket, requireSafeObjectPath, bucketIdParam, bodyField, queryField } = require('../Modules/storage/bucketAccess');

const COMPANY_A = '64b1f0c2a1b2c3d4e5f60718';
const COMPANY_B = '64b1f0c2a1b2c3d4e5f60719';
const USER_OF_A = '64b1f0c2a1b2c3d4e5f607aa';

const members = { [USER_OF_A]: [COMPANY_A] };

function run(middleware, req) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ nextCalled: false, status: this.statusCode, body }); return this; },
        };
        Promise.resolve(middleware(req, res, () => resolve({ nextCalled: true }))).catch((error) => resolve({ error }));
    });
}

beforeEach(() => {
    verifyCompanyMembership.mockReset();
    verifyCompanyMembership.mockImplementation(async (uid, companyId) => (members[uid] || []).includes(companyId));
});

describe('requireOwnBucket', () => {
    const ownBucket = requireOwnBucket(bucketIdParam);

    it('answers 401 when no session was verified', async () => {
        const out = await run(ownBucket, { params: { bucketId: COMPANY_A } });
        expect(out).toMatchObject({ nextCalled: false, status: 401, body: { status: false } });
    });

    it('lets a member reach their own company bucket', async () => {
        const out = await run(ownBucket, { uid: USER_OF_A, aud: COMPANY_A, params: { bucketId: COMPANY_A } });
        expect(out.nextCalled).toBe(true);
    });

    it('refuses company A asking for company B', async () => {
        const out = await run(ownBucket, { uid: USER_OF_A, aud: COMPANY_A, params: { bucketId: COMPANY_B } });
        expect(out).toMatchObject({ nextCalled: false, status: 403, body: { status: false } });
        expect(verifyCompanyMembership).not.toHaveBeenCalled();
    });

    it('refuses a company still in a stale token audience once membership is gone', async () => {
        const out = await run(ownBucket, { uid: USER_OF_A, aud: `${COMPANY_A},${COMPANY_B}`, params: { bucketId: COMPANY_B } });
        expect(out.status).toBe(403);
        expect(verifyCompanyMembership).toHaveBeenCalledWith(USER_OF_A, COMPANY_B);
    });

    it.each(['USER_PROFILES', '.*', '', `../${COMPANY_A}`, `${COMPANY_A},${COMPANY_B}`])('refuses %p as a company bucket', async (bucketId) => {
        const out = await run(ownBucket, { uid: USER_OF_A, aud: `${COMPANY_A},${COMPANY_B}`, params: { bucketId } });
        expect(out.status).toBe(403);
    });

    it('reads the company from the body for the signing routes', async () => {
        const fromBody = requireOwnBucket(bodyField('companyId'));
        expect((await run(fromBody, { uid: USER_OF_A, aud: COMPANY_A, body: { companyId: COMPANY_A } })).nextCalled).toBe(true);
        expect((await run(fromBody, { uid: USER_OF_A, aud: COMPANY_A, body: { companyId: COMPANY_B } })).status).toBe(403);
    });
});

describe('requireSafeObjectPath', () => {
    const safePath = requireSafeObjectPath(queryField('filepath'));

    it('accepts a path inside the bucket', async () => {
        expect((await run(safePath, { query: { filepath: 'setting/task_type/task.png' } })).nextCalled).toBe(true);
    });

    it.each([`../${COMPANY_B}/secret.png`, 'a/../../b', '/etc/passwd', '\\share', '', undefined])('refuses %p', async (filepath) => {
        const out = await run(safePath, { query: { filepath } });
        expect(out).toMatchObject({ nextCalled: false, status: 400 });
    });
});
