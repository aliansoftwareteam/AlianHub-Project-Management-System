/**
 * Unit check for the task-type migration's pure logic (scripts/migrate-task-type-icons.js).
 * Requires only the exported helpers — no DB connection. Run: node .claude/tests/test-task-type-migration.js
 */
const assert = require('assert');
const { rekey, mapFor, isBadKey, STATUS_LIKE } = require('../../scripts/migrate-task-type-icons');

// isBadKey: NaN / non-integer / missing are bad; finite integers are fine.
assert.strictEqual(isBadKey(NaN), true);
assert.strictEqual(isBadKey(undefined), true);
assert.strictEqual(isBadKey(1.5), true);
assert.strictEqual(isBadKey(23), false);

// mapFor: known value, keyword fallback, generic fallback.
assert.deepStrictEqual(mapFor({ value: 'bug' }), { icon: 'mdi:bug', color: '#DC2626' });
assert.deepStrictEqual(mapFor({ value: 'design' }), { icon: 'mdi:palette', color: '#F76808' });
assert.strictEqual(mapFor({ value: 'zzz custom bug thing' }).icon, 'mdi:bug'); // keyword hit
assert.deepStrictEqual(mapFor({ value: 'totally_unknown' }), { icon: 'mdi:checkbox-marked-circle-outline', color: '#2F3990' });

// STATUS_LIKE membership.
assert.ok(STATUS_LIKE.has('done') && STATUS_LIKE.has('complete') && !STATUS_LIKE.has('task'));

// rekey against the real company catalog (NaN sextet at 23, dupes at 12/13).
const N = NaN;
const cat = [
    ['task', 1], ['design', 2], ['bug', 3], ['sub_task', 4], ['bid', 5], ['invitation', 6],
    ['existing_client', 7], ['client_meeting', 8], ['discussion', 9], ['leads', 10], ['to_do', 11],
    ['training_task', 12], ['admin', 13],
    ['user_interface_(ui)', N], ['user_experience_(ux)', N], ['graphic_design', N], ['branding', N],
    ['web_design', N], ['print_design', N], ['motion_graphics', N], ['photography/videography', N],
    ['content_creation', N], ['storyboarding', N], ['feedback_&_revision', N],
    ['financial_analysis', 12], ['bookkeeping', 13], ['auditing', 14], ['taxation', 15],
    ['financial_reporting', 16], ['cost_management', 17], ['cash_management', 18],
    ['engagement_tasks', 19], ['collaboration_tasks', 20], ['support_tasks', 21], ['content_creation_tasks', 22],
    ['in_progress', 23], ['in_review', 23], ['backlog', 23], ['approved', 23], ['done', 23], ['complete', 23],
    ['backlog_refinement', 29], ['development', 30], ['sprint_planning', 31], ['optimization', 32], ['image', 33],
].map(([value, key]) => ({ value, key }));

const { entries, changes, dupValues } = rekey(cat);
const keys = entries.map((e) => e.key);
const byVal = Object.fromEntries(entries.map((e) => [e.value, e.key]));

assert.ok(keys.every(Number.isInteger), 'all final keys integers');
assert.strictEqual(new Set(keys).size, keys.length, 'all final keys unique');
assert.strictEqual(byVal.task, 1, 'task keeps 1');
assert.strictEqual(byVal.training_task, 12, 'first-at-12 keeps 12');
assert.strictEqual(byVal.admin, 13, 'first-at-13 keeps 13');
assert.strictEqual(byVal.in_progress, 23, 'first-at-23 keeps 23');
assert.notStrictEqual(byVal.financial_analysis, 12, 'financial_analysis re-keyed');
['in_review', 'backlog', 'approved', 'done', 'complete'].forEach((v) =>
    assert.notStrictEqual(byVal[v], 23, `${v} re-keyed off 23`));
assert.strictEqual(changes.length, 18, `expected 18 re-keys (11 NaN + 1@12 + 1@13 + 5@23), got ${changes.length}`);
assert.strictEqual(dupValues.length, 0, 'no same-value duplicates in this catalog');

console.log(`ok — migration logic: ${entries.length} entries, ${changes.length} re-keyed, all keys unique`);
