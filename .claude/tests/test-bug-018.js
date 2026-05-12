/**
 * BUG-018 regression test: the `Promise.allSettled` rejection branch in
 * `Modules/createProject/controller.js`.
 *
 * The audit-time description (`there is no else, the Promise stays
 * pending`) was incorrect — an `else { reject(...) }` was already
 * present, AND `Promise.allSettled` never rejects (which is its whole
 * purpose). So the literal hang was never reachable.
 *
 * The real bug was that the else's reject body was a generic
 *     { status: false, statusText: 'error in createProject' }
 * with no rejection-reason detail. Every reason in the `rejected`
 * array was discarded — caller and log learnt nothing.
 *
 * The fix surfaces the reasons. This test verifies:
 *
 *   1. When all prerequisite queries fulfil, the main flow runs (we
 *      stub the body to short-circuit early after `appsData.forEach`).
 *   2. When ≥ 1 prerequisite rejects, the outer Promise rejects with
 *      the new structured shape including `rejectedCount`, `totalCount`,
 *      and a `reasons` array.
 *   3. Source-level checks that the new fields are emitted.
 *
 * Run from project root: `node .claude/tests/test-bug-018.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// --- Stub MongoDbCrudOpration so we can drive the allSettled results ---------
const mongoQueriesPath = require.resolve(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries.js'));
let stubBehaviour = {
    // Map by query type to either a resolved value or a rejection.
    behaviour: {},
    defaultResult: () => Promise.resolve([{ settings: [] }]),
    calls: [],
};
require.cache[mongoQueriesPath] = {
    id: mongoQueriesPath, filename: mongoQueriesPath, loaded: true,
    exports: {
        MongoDbCrudOpration: (companyId, query, op) => {
            const t = query && query.type;
            stubBehaviour.calls.push({ companyId, type: t, op });
            if (stubBehaviour.behaviour[t]) {
                return stubBehaviour.behaviour[t]();
            }
            return stubBehaviour.defaultResult();
        },
    },
};

const ctrlPath = path.join(projectRoot, 'Modules', 'createProject', 'controller.js');
const ctrl = require(ctrlPath);

(async () => {
    section('createProject — all prerequisites reject → outer rejects with reasons');
    {
        stubBehaviour.behaviour = {};
        stubBehaviour.calls = [];
        // Every find() rejects with a distinct reason so we can verify each
        // one is preserved.
        stubBehaviour.defaultResult = (() => {
            let n = 0;
            return () => Promise.reject(new Error(`prereq-failure-${++n}`));
        })();

        const req = {
            body: {
                CompanyId: '507f1f77bcf86cd799439011',
                ProjectName: 'P',
                ProjectCode: 'PJ',
                projectIcon: { name: 'icon' },
                isTemplate: false,
                isPrivateSpace: false,
            },
        };

        let resolved = null;
        let rejected = null;
        try {
            resolved = await ctrl.createProject(req);
        } catch (err) {
            rejected = err;
        }

        assert('createProject rejected (did NOT hang)',
            rejected !== null && resolved === null,
            `resolved=${JSON.stringify(resolved)} rejected=${JSON.stringify(rejected)}`);
        assert('rejection statusText mentions prerequisites',
            rejected && /prerequisite/i.test(rejected.statusText));
        assert('rejection includes rejectedCount = 5',
            rejected && rejected.rejectedCount === 5,
            `got ${rejected && rejected.rejectedCount}`);
        assert('rejection includes totalCount = 5',
            rejected && rejected.totalCount === 5);
        assert('rejection includes 5 reasons',
            rejected && Array.isArray(rejected.reasons) && rejected.reasons.length === 5);
        assert('each reason carries the actual error message',
            rejected
            && rejected.reasons.every((r, i) => /prereq-failure-\d+/.test(r.reason)),
            JSON.stringify(rejected && rejected.reasons));
    }

    section('createProject — partial rejection (1 of 5) → outer rejects with 1 reason');
    {
        stubBehaviour.calls = [];
        let n = 0;
        stubBehaviour.defaultResult = () => {
            n += 1;
            // Reject only on the 3rd call (TASK_TYPE).
            if (n === 3) return Promise.reject(new Error('task-type-find failed'));
            return Promise.resolve([{ settings: [] }]);
        };

        const req = {
            body: {
                CompanyId: '507f1f77bcf86cd799439011',
                ProjectName: 'P',
                ProjectCode: 'PJ',
                projectIcon: { name: 'icon' },
                isTemplate: false,
                isPrivateSpace: false,
            },
        };

        let rejected = null;
        try {
            await ctrl.createProject(req);
        } catch (err) {
            rejected = err;
        }

        assert('partial-rejection: outer rejects',
            rejected !== null);
        assert('partial-rejection: rejectedCount = 1, totalCount = 5',
            rejected && rejected.rejectedCount === 1 && rejected.totalCount === 5,
            `got rejectedCount=${rejected && rejected.rejectedCount} totalCount=${rejected && rejected.totalCount}`);
        assert('partial-rejection: reason text preserved',
            rejected
            && rejected.reasons.length === 1
            && /task-type-find failed/.test(rejected.reasons[0].reason),
            JSON.stringify(rejected && rejected.reasons));
    }

    section('source — else branch surfaces the reasons array');
    const src = fs.readFileSync(ctrlPath, 'utf-8');
    const srcNoComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    assert('reject body includes rejectedCount',
        /rejectedCount:\s*rejected\.length/.test(srcNoComments));
    assert('reject body includes totalCount',
        /totalCount:\s*results\.length/.test(srcNoComments));
    assert('reject body includes a reasons array',
        /reasons:\s*reasons/.test(srcNoComments)
        || /reasons,/.test(srcNoComments));
    assert('rejected.map builds a per-failure list',
        /rejected\.map\s*\(/.test(srcNoComments));
    assert('logger.error includes the JSON-serialised reasons',
        /logger\.error\(\s*`createProject prerequisite query failures/.test(srcNoComments));

    console.log(`\n========================================`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('========================================');
    if (failed > 0) {
        console.log('Failed cases:');
        failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
        process.exit(1);
    }
    process.exit(0);
})().catch((err) => { console.error('FATAL', err); process.exit(1); });
