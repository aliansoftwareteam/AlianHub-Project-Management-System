/**
 * BUG-014 regression test: `Modules/auth/controller/verifyEmail.js:68-76`
 * had three bugs that combined into a verification bypass:
 *
 *   1. Input validation used `!req.body.token`, so `{ token: [] }` passed.
 *   2. The success check used `==` (loose equality): `"" == []` is `true`,
 *      so any account with stored `verificationToken === ""` could be
 *      re-verified by sending an empty-array token.
 *   3. No fallback `else` — unmatched states left the request hanging.
 *
 * The fix rewrites the handler with strict type/length checks and `===`.
 * This test stubs the Mongo handler so the controller can be exercised
 * without a real DB.
 *
 * Run from project root: `node .claude/tests/test-bug-014.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const mongoRef = require(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries'));
const ctrlPath = path.join(projectRoot, 'Modules', 'auth', 'controller', 'verifyEmail.js');
const ctrl = require(ctrlPath);

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// --- Test harness --------------------------------------------------------
// Stub MongoDbCrudOpration with per-test oracles. `findOne` returns the
// configured user document; `findOneAndUpdate` records the call and
// resolves to the user (mirroring the real behaviour).
const originalCrud = mongoRef.MongoDbCrudOpration;
let userDoc = null;
let updateCalls = [];
let findOneShouldReject = false;
let updateShouldReject = false;
mongoRef.MongoDbCrudOpration = async (db, obj, op) => {
    if (op === 'findOne') {
        if (findOneShouldReject) throw new Error('findOne stub failure');
        return userDoc;
    }
    if (op === 'findOneAndUpdate') {
        if (updateShouldReject) throw new Error('findOneAndUpdate stub failure');
        updateCalls.push({ db, op, data: obj.data });
        return userDoc;
    }
    return originalCrud(db, obj, op);
};

function makeMockReqRes(body) {
    const state = { sendCount: 0, lastBody: null };
    const res = {
        send(payload) { state.lastBody = payload; state.sendCount += 1; return res; },
        status() { return res; },
    };
    return { req: { body }, res, state };
}

async function waitTicks(n = 4) {
    for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
}

const VALID_UID = '507f1f77bcf86cd799439011';
const VALID_TOKEN = 'a'.repeat(64);

(async () => {
    // ----- input validation --------------------------------------------------
    section('input validation — uid');
    {
        const { req, res, state } = makeMockReqRes({});
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('missing uid → "uid is required."',
            state.lastBody && /uid is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: '' });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('empty-string uid → "uid is required."',
            state.lastBody && /uid is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: [], token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('array uid → "uid is required."',
            state.lastBody && /uid is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: 12345, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('numeric uid → "uid is required."',
            state.lastBody && /uid is required/.test(state.lastBody.statusText));
    }

    section('input validation — token');
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('missing token → "token is required."',
            state.lastBody && /token is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: '' });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('empty-string token → "token is required."',
            state.lastBody && /token is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: [] });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('BUG-014 attack vector — array token blocked early',
            state.lastBody && /token is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: {} });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('object token blocked early', state.lastBody && /token is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: 0 });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('number token blocked early', state.lastBody && /token is required/.test(state.lastBody.statusText));
    }
    {
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: null });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('null token blocked early', state.lastBody && /token is required/.test(state.lastBody.statusText));
    }

    // ----- post-DB-lookup branches --------------------------------------------
    section('user not found');
    {
        userDoc = null;
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('returns "Couldn’t find your Account"',
            state.lastBody && /Couldn.t find your Account/.test(state.lastBody.statusText));
        assert('sendCount is exactly 1', state.sendCount === 1);
    }

    section('user already verified');
    {
        updateCalls = [];
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: true,
            verificationToken: VALID_TOKEN,
            Employee_Email: 'qa@example.com',
        };
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('returns alreadyVarified',
            state.lastBody && state.lastBody.alreadyVarified === true);
        assert('clears the verificationToken in DB',
            updateCalls.length === 1
            && updateCalls[0].data
            && updateCalls[0].data[1].$set.verificationToken === '');
    }

    section('stored token empty (the original bypass vector)');
    {
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: false,
            verificationToken: '',
            verificationTokenTime: new Date(),
            Employee_Email: 'qa@example.com',
        };
        // Try the bypass payload first — `token: []` would have matched `""`
        // under the old `==` comparison, but is now rejected at input validation.
        {
            const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: [] });
            ctrl.verifyEmail(req, res);
            await waitTicks();
            assert('attack: {token:[]} blocked at input',
                state.lastBody && /token is required/.test(state.lastBody.statusText));
        }
        {
            // A non-empty string token vs empty stored token: must be rejected
            // (no hang, no bypass).
            updateCalls = [];
            const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
            ctrl.verifyEmail(req, res);
            await waitTicks();
            assert('non-empty token vs empty stored → "This link is expired"',
                state.lastBody && /This link is expired/.test(state.lastBody.statusText)
                && state.lastBody.showResendVerification === true);
            assert('did NOT mark user verified (no findOneAndUpdate)',
                updateCalls.length === 0);
            assert('response was sent exactly once (no hang)', state.sendCount === 1);
        }
    }

    section('stored verificationTokenTime missing / invalid → expired (not bypassed)');
    {
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: false,
            verificationToken: VALID_TOKEN,
            verificationTokenTime: null, // missing
            Employee_Email: 'qa@example.com',
        };
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('null verificationTokenTime → "expired" (pre-fix: silently bypassed)',
            state.lastBody && /This link is expired/.test(state.lastBody.statusText));
    }
    {
        userDoc.verificationTokenTime = 'not-a-date';
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('invalid verificationTokenTime → "expired"',
            state.lastBody && /This link is expired/.test(state.lastBody.statusText));
    }

    section('token expired (>10 min)');
    {
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: false,
            verificationToken: VALID_TOKEN,
            verificationTokenTime: new Date(Date.now() - 11 * 60 * 1000), // 11 min ago
            Employee_Email: 'qa@example.com',
        };
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('11 min old token → "expired"',
            state.lastBody && /This link is expired/.test(state.lastBody.statusText));
    }

    section('valid token, but does not match');
    {
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: false,
            verificationToken: VALID_TOKEN,
            verificationTokenTime: new Date(), // just now
            Employee_Email: 'qa@example.com',
        };
        updateCalls = [];
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: 'b'.repeat(64) });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('mismatched non-empty token → "expired"',
            state.lastBody && /This link is expired/.test(state.lastBody.statusText));
        assert('no DB write on mismatch', updateCalls.length === 0);
    }

    section('happy path — valid, non-expired, matching token');
    {
        userDoc = {
            _id: VALID_UID,
            isEmailVerified: false,
            verificationToken: VALID_TOKEN,
            verificationTokenTime: new Date(),
            Employee_Email: 'qa@example.com',
        };
        updateCalls = [];
        const { req, res, state } = makeMockReqRes({ uid: VALID_UID, token: VALID_TOKEN });
        ctrl.verifyEmail(req, res);
        await waitTicks();
        assert('success response',
            state.lastBody && state.lastBody.status === true
            && /Email verified successfully/.test(state.lastBody.statusText));
        assert('DB updated: isEmailVerified=true, verificationToken=""',
            updateCalls.length === 1
            && updateCalls[0].data[1].$set.isEmailVerified === true
            && updateCalls[0].data[1].$set.verificationToken === '');
    }

    // ----- source-level grep --------------------------------------------------
    section('source — bypass-prone patterns are gone');
    const src = fs.readFileSync(ctrlPath, 'utf-8');
    const srcNoComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert('no executable `==` token comparison (uses ===)',
        !/verificationToken\s*==\s*req\.body\.token/.test(srcNoComments));
    assert('source uses strict typeof check on req.body.uid',
        /typeof\s+req\.body\.uid\s*!==\s*['"]string['"]/.test(srcNoComments));
    assert('source uses strict typeof check on req.body.token',
        /typeof\s+req\.body\.token\s*!==\s*['"]string['"]/.test(srcNoComments));
    assert('source rejects empty stored verificationToken',
        /storedToken\.length\s*===\s*0/.test(srcNoComments));

    mongoRef.MongoDbCrudOpration = originalCrud;

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
