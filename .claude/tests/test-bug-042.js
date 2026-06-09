/**
 * BUG-042 regression — drop `moment` from the backend; standardise on
 * luxon (per CLAUDE.md). Frontend `moment` is out of scope for this
 * PR (hundreds of call sites; separate migration).
 *
 * Post-fix:
 *   1. Root package.json no longer lists `moment`.
 *   2. `Modules/**.js` has no live `require('moment')` calls.
 *   3. The new `utils/dateHelpers.js` is wired in.
 *   4. The token translator converts moment-style → luxon-style for
 *      common tokens used in the backend.
 *   5. `formatDate` and `formatNotificationDate` round-trip a known
 *      input to the expected output.
 */

const fs = require('fs');
const path = require('path');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const ROOT = path.resolve(__dirname, '../..');

// 1. Root package.json no longer lists moment.
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
assert(!('moment' in allDeps), 'root package.json no longer lists `moment`');

// 2. Backend has no live require('moment').
// git grep exits 1 when nothing matches — treat that as success.
let grepResult = '';
try {
    grepResult = require('child_process').execSync(
        'git grep -l "require(\'moment\')" -- "Modules/**.js" "Config/**.js" "utils/**.js"',
        { cwd: ROOT, encoding: 'utf8' }
    ).trim();
} catch (e) {
    grepResult = (e.stdout || '').toString().trim();
}
assert(grepResult === '', `Modules/Config/utils backend code has no live require('moment') (found ${grepResult || 'none'})`);

// 3. dateHelpers.js is wired into each previously-moment-using file.
const wiringChecks = [
    ['Modules/logTime/controllerV2.js', 'formatDate'],
    ['Modules/notification/sendEmail/controllerV2.js', 'formatNotificationDate'],
    ['Modules/notification/sendEmail/controller.js', 'formatNotificationDate'],
    ['Modules/tasks/helpers/helper.js', 'formatDate'],
    ['Modules/tasks/helpers/mongo_helper.js', 'formatDate'],
];
wiringChecks.forEach(([file, sym]) => {
    const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
    assert(
        new RegExp(`require\\(.*dateHelpers.*\\)`).test(src) && new RegExp(`\\b${sym}\\b`).test(src),
        `${file} requires dateHelpers and uses ${sym}`
    );
});

// 4. Token translator works.
const { momentToLuxonFormat, formatDate, formatNotificationDate } = require(path.resolve(ROOT, 'utils/dateHelpers.js'));
assert(momentToLuxonFormat('YYYY-MM-DD') === 'yyyy-LL-dd', "translator: YYYY-MM-DD → yyyy-LL-dd");
assert(momentToLuxonFormat('DD/MM/YYYY HH:mm:ss') === 'dd/LL/yyyy HH:mm:ss', "translator: preserves HH:mm:ss, swaps DD/MM/YYYY");
assert(momentToLuxonFormat('yyyy-LL-dd') === 'yyyy-LL-dd', "translator: luxon-style input passes through");

// 5. formatDate/formatNotificationDate round-trip.
const sampleDate = new Date(Date.UTC(2024, 0, 15, 10, 30, 0)); // 2024-01-15 10:30 UTC
assert(formatDate(sampleDate, 'YYYY-MM-DD') === '2024-01-15', "formatDate('YYYY-MM-DD') = 2024-01-15");
assert(formatDate(sampleDate, 'yyyy-LL-dd') === '2024-01-15', "formatDate accepts luxon-style too");

const notif = formatNotificationDate(sampleDate);
assert(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2} (AM|PM) \[IST\]$/.test(notif), `formatNotificationDate output matches 'DD-MM-YYYY HH:MM A [IST]' shape (got ${notif})`);

// 6. {seconds} timestamp form supported.
const fromSec = formatDate({ seconds: sampleDate.getTime() / 1000 }, 'YYYY-MM-DD');
// Allow either format depending on local TZ
assert(/^\d{4}-\d{2}-\d{2}$/.test(fromSec), `formatDate handles {seconds} timestamp shape (got ${fromSec})`);

console.log('\nAll BUG-042 assertions passed.');
