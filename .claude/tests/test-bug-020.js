/**
 * BUG-020 regression test: the cache writer in `MainChats.getChats` used
 *   `mainChat:${req.headers['companyid']}`
 * while the invalidator in `MainChats.updateMainChat` built a different
 * key from the *document's* `_id`. The two keys never matched, so cache
 * invalidation was a no-op and stale chats stayed cached until TTL.
 *
 * The fix centralises the key builder. This test verifies:
 *   - The exported `mainChatCacheKey(companyId)` produces the expected shape.
 *   - The invalidator now removes the same key the setter wrote.
 *   - Source no longer contains the broken `JSON.parse(JSON.stringify(result))?._id`
 *     cache-key pattern.
 *
 * Run from project root: `node .claude/tests/test-bug-020.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

// Stub MongoDbCrudOpration so updateMainChat can run without Mongo.
const mongoQueriesPath = require.resolve(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries.js'));
require.cache[mongoQueriesPath] = {
    id: mongoQueriesPath, filename: mongoQueriesPath, loaded: true,
    exports: {
        MongoDbCrudOpration: () => Promise.resolve({ _id: 'some-doc-id-not-the-company' }),
    },
};

const ctrlPath = path.join(projectRoot, 'Modules', 'MainChats', 'controller.js');
const ctrl = require(ctrlPath);
const { myCache } = require(path.join(projectRoot, 'Config', 'config.js'));

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('mainChatCacheKey — shape + parity');

const COMPANY_ID = '507f1f77bcf86cd799439011';
const expectedKey = `mainChat:${COMPANY_ID}`;
assert('helper is exported', typeof ctrl.mainChatCacheKey === 'function');
assert('helper produces `mainChat:<companyId>`',
    ctrl.mainChatCacheKey(COMPANY_ID) === expectedKey);

section('updateMainChat invalidates the key the setter wrote');

// Simulate a previously-cached page.
myCache.set(expectedKey, [{ name: 'stale chat' }], 60);
assert('seed: cache hit before update', myCache.get(expectedKey) !== undefined);

// Run the update path (Mongo response uses a *different* _id to prove the
// fix uses companyId, not the doc id).
(async () => {
    await ctrl.updateMainChat(COMPANY_ID, [{ _id: 'whatever' }]);
    await new Promise((r) => setImmediate(r));

    assert('after update: cache entry for companyId is invalidated',
        myCache.get(expectedKey) === undefined,
        `still cached: ${JSON.stringify(myCache.get(expectedKey))}`);

    // Sanity: writing the doc-id key would NOT have invalidated it.
    myCache.set(expectedKey, [{ name: 'fresh stale' }], 60);
    myCache.set('mainChat:some-doc-id-not-the-company', [{ marker: true }], 60);
    await ctrl.updateMainChat(COMPANY_ID, [{ _id: 'whatever' }]);
    await new Promise((r) => setImmediate(r));
    assert('companyId-keyed entry is invalidated',
        myCache.get(expectedKey) === undefined);

    section('source — broken JSON.parse(JSON.stringify(...)) pattern is gone');
    const src = fs.readFileSync(ctrlPath, 'utf-8');
    const srcNoComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert('no executable JSON.parse(JSON.stringify(result))?._id pattern',
        !/JSON\.parse\(JSON\.stringify\(result\)\)\?\._id/.test(srcNoComments));
    assert('source uses the shared mainChatCacheKey helper',
        /removeCache\(\s*mainChatCacheKey\(/.test(srcNoComments)
        && /myCache\.set\(\s*cacheKey\b/.test(srcNoComments));

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
