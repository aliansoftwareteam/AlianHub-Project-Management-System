/**
 * BUG-013 regression test: the JWT audience claim was frozen at login,
 * so a user removed from a company kept access for up to JWT_EXP (24h
 * default). Add a cached membership re-check that runs after the JWT +
 * audience verification.
 *
 * This test stubs `mongoC.MongoDbCrudOpration` so the helper can be
 * exercised without Mongo, and verifies:
 *   - first call → Mongo lookup → result cached
 *   - second call → cache hit → no extra Mongo call
 *   - invalidateMembershipCache(uid, companyId) → next call hits Mongo again
 *   - invalidateMembershipCache(uid) → wipes all entries for that uid
 *   - both middlewares (verifyJWTTokenWithC, verifyJWTTokenWithCV2) now
 *     return 403 when the membership check fails, even with a valid JWT
 *
 * Run from project root: `node .claude/tests/test-bug-013.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

// Spin up env *before* requiring jwt.js so it picks up these values.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-bug-013-' + Date.now();
process.env.JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';
process.env.JWT_EXP = process.env.JWT_EXP || '24h';
process.env.MEMBERSHIP_CACHE_TTL_SECONDS = '60';

const mongoC = require(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries'));
const jwtModule = require(path.join(projectRoot, 'Config', 'jwt.js'));
const { myCache } = require(path.join(projectRoot, 'Config', 'config.js'));
const jwt = require('jsonwebtoken');

const { verifyCompanyMembership, invalidateMembershipCache, getMembershipCacheTtlSeconds, generateJWTToken, verifyJWTTokenWithC, verifyJWTTokenWithCV2 } = jwtModule;

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// Stub the Mongo handler. Track how many times the membership query is made
// and let each test set the "is member" oracle.
let mongoCalls = [];
let oracleIsMember = true;
const originalCrud = mongoC.MongoDbCrudOpration;
mongoC.MongoDbCrudOpration = async (db, obj, op) => {
    if (obj && obj.data && obj.data[0] && obj.data[0].AssignCompany) {
        mongoCalls.push({ db, op, query: obj.data[0] });
        if (!oracleIsMember) return null;
        return { _id: 'doc-id', AssignCompany: [String(obj.data[0].AssignCompany)] };
    }
    // Fall through to original for unrelated calls.
    return originalCrud(db, obj, op);
};

const UID_A      = '507f1f77bcf86cd799439011';
const COMPANY_A  = '507f1f77bcf86cd799439022';
const COMPANY_B  = '507f1f77bcf86cd799439033';

function clearCache() {
    myCache.keys()
        .filter((k) => k.indexOf('membership:') === 0)
        .forEach((k) => myCache.del(k));
}

(async () => {
    section('getMembershipCacheTtlSeconds — defaults / env');
    assert('default is 60s', getMembershipCacheTtlSeconds() === 60);
    process.env.MEMBERSHIP_CACHE_TTL_SECONDS = '5';
    assert('env override takes effect', getMembershipCacheTtlSeconds() === 5);
    process.env.MEMBERSHIP_CACHE_TTL_SECONDS = '0';
    assert('zero disables caching (returns 0)', getMembershipCacheTtlSeconds() === 0);
    process.env.MEMBERSHIP_CACHE_TTL_SECONDS = 'not-a-number';
    assert('non-numeric falls back to default', getMembershipCacheTtlSeconds() === 60);
    process.env.MEMBERSHIP_CACHE_TTL_SECONDS = '60';

    section('verifyCompanyMembership — input validation');
    mongoCalls = []; clearCache();
    assert('returns false for missing uid', (await verifyCompanyMembership('', COMPANY_A)) === false);
    assert('returns false for missing companyId', (await verifyCompanyMembership(UID_A, '')) === false);
    assert('returns false for non-ObjectId uid', (await verifyCompanyMembership('not-an-id', COMPANY_A)) === false);
    assert('returns false for non-ObjectId companyId', (await verifyCompanyMembership(UID_A, 'bad')) === false);
    assert('no Mongo call for invalid inputs', mongoCalls.length === 0);

    section('verifyCompanyMembership — cache miss → hit → invalidate');
    mongoCalls = []; clearCache();
    oracleIsMember = true;
    const r1 = await verifyCompanyMembership(UID_A, COMPANY_A);
    assert('first call returns true (member)', r1 === true);
    assert('first call issued exactly 1 Mongo lookup', mongoCalls.length === 1);
    const r2 = await verifyCompanyMembership(UID_A, COMPANY_A);
    assert('second call returns true', r2 === true);
    assert('second call did NOT hit Mongo (cache hit)', mongoCalls.length === 1);

    invalidateMembershipCache(UID_A, COMPANY_A);
    const r3 = await verifyCompanyMembership(UID_A, COMPANY_A);
    assert('after invalidate(uid, companyId) → Mongo lookup happens again',
        mongoCalls.length === 2 && r3 === true);

    // Negative cache: oracle flips to non-member.
    invalidateMembershipCache(UID_A, COMPANY_A);
    oracleIsMember = false;
    const r4 = await verifyCompanyMembership(UID_A, COMPANY_A);
    assert('non-member returns false', r4 === false);
    const r5 = await verifyCompanyMembership(UID_A, COMPANY_A);
    assert('negative result is cached too', r5 === false && mongoCalls.length === 3);

    section('invalidateMembershipCache(uid) — wipes all entries for that user');
    mongoCalls = []; clearCache();
    oracleIsMember = true;
    await verifyCompanyMembership(UID_A, COMPANY_A);
    await verifyCompanyMembership(UID_A, COMPANY_B);
    assert('cached both companies', mongoCalls.length === 2);
    invalidateMembershipCache(UID_A);
    await verifyCompanyMembership(UID_A, COMPANY_A);
    await verifyCompanyMembership(UID_A, COMPANY_B);
    assert('both companies re-queried after uid-wide invalidate',
        mongoCalls.length === 4);

    section('verifyJWTTokenWithC — 403 when membership check fails');
    clearCache();
    oracleIsMember = false;
    const token = generateJWTToken({ uid: UID_A, companyIds: [COMPANY_A] });
    const req = { headers: { authorization: 'Bearer ' + token, companyid: COMPANY_A }, body: {}, };
    let respStatus = null;
    let respBody = null;
    const res = {
        status(c) { respStatus = c; return res; },
        json(b) { respBody = b; return res; },
        clearCookie() { return res; },
    };
    let nextCalled = false;
    await verifyJWTTokenWithC(req, res, () => { nextCalled = true; });
    assert('verifyJWTTokenWithC → 403 when user is not a current member',
        respStatus === 403, `status=${respStatus}`);
    assert('verifyJWTTokenWithC → next() NOT called when non-member',
        !nextCalled);
    assert('verifyJWTTokenWithC → response body sets isLogout flag',
        respBody && respBody.isLogout === true);
    assert('verifyJWTTokenWithC → statusText is Forbidden',
        respBody && respBody.statusText === 'Forbidden');

    section('verifyJWTTokenWithC — pass-through when member');
    clearCache();
    oracleIsMember = true;
    const req2 = { headers: { authorization: 'Bearer ' + token, companyid: COMPANY_A }, body: {}, };
    respStatus = null; respBody = null; nextCalled = false;
    const res2 = {
        status(c) { respStatus = c; return res2; },
        json(b) { respBody = b; return res2; },
        clearCookie() { return res2; },
    };
    await verifyJWTTokenWithC(req2, res2, () => { nextCalled = true; });
    assert('verifyJWTTokenWithC → next() called when membership confirmed',
        nextCalled && respStatus === null);
    assert('verifyJWTTokenWithC → req.uid is set from the token',
        req2.uid === UID_A);

    section('verifyJWTTokenWithCV2 — 403 when membership check fails');
    clearCache();
    oracleIsMember = false;
    const reqV2 = { headers: { authorization: 'Bearer ' + token, companyid: COMPANY_A }, body: {}, };
    let v2Status = null;
    let v2Body = null;
    const resV2 = {
        status(c) { v2Status = c; return resV2; },
        json(b) { v2Body = b; return resV2; },
        clearCookie() { return resV2; },
    };
    let v2Next = false;
    await verifyJWTTokenWithCV2(reqV2, resV2, () => { v2Next = true; });
    assert('verifyJWTTokenWithCV2 → 403 on non-member',
        v2Status === 403, `status=${v2Status}`);
    assert('verifyJWTTokenWithCV2 → next() NOT called',
        !v2Next);

    section('source — middlewares exist + helpers exported');
    const src = fs.readFileSync(path.join(projectRoot, 'Config', 'jwt.js'), 'utf-8');
    const srcNoComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert('verifyJWTTokenWithC is now async',
        /verifyJWTTokenWithC\s*=\s*async\s*\(/.test(srcNoComments));
    assert('verifyJWTTokenWithCV2 is now async',
        /verifyJWTTokenWithCV2\s*=\s*async\s*\(/.test(srcNoComments));
    assert('verifyCompanyMembership is called inside both middlewares',
        (srcNoComments.match(/verifyCompanyMembership\s*\(/g) || []).length >= 2);
    assert('module exports verifyCompanyMembership',
        /verifyCompanyMembership\s*[:,]/.test(srcNoComments.split('module.exports')[1] || ''));
    assert('module exports invalidateMembershipCache',
        /invalidateMembershipCache\s*[:,]/.test(srcNoComments.split('module.exports')[1] || ''));

    // Restore Mongo stub
    mongoC.MongoDbCrudOpration = originalCrud;

    console.log(`\n========================================`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('========================================');
    if (failed > 0) {
        console.log('Failed cases:');
        failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
        process.exit(1);
    }
    process.exit(0);
})().catch((err) => {
    console.error('FATAL', err);
    process.exit(1);
});
