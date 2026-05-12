/**
 * BUG-035 regression — cron jobs without `tz` option.
 *
 * Pre-fix: `cron.js` called `schedule.scheduleJob('0 0 * * *', ...)`,
 * which resolves the schedule in the server's local timezone. DST
 * shifts or container-tz changes silently move the wall-clock firing
 * time.
 *
 * Post-fix: every `scheduleJob` call passes a `{ rule, tz }` object so
 * the schedule is pinned to a known tz (default UTC, env-tunable via
 * `CRON_TZ`).
 *
 * We don't want to load `cron.js` (it would spin up real cron jobs
 * and pull in storage/AI dependencies). Instead, parse the source and
 * grep for the pattern.
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

const cronSrc = fs.readFileSync(path.resolve(__dirname, '../../cron.js'), 'utf8');

// 1. The CRON_TZ env hook is wired with a UTC default.
assert(
    /CRON_TZ\s*=\s*process\.env\.CRON_TZ\s*\|\|\s*['"]UTC['"]/.test(cronSrc),
    'cron.js reads CRON_TZ from env with UTC default'
);

// 2. Every scheduleJob call uses the object form with a tz field.
const scheduleCalls = cronSrc.match(/scheduleJob\s*\([^)]*\)/g) || [];
assert(scheduleCalls.length >= 4, `at least four scheduleJob calls present (found ${scheduleCalls.length})`);

scheduleCalls.forEach((call, idx) => {
    assert(/rule\s*:/.test(call), `scheduleJob[${idx}] uses { rule: ... } object form`);
    assert(/tz\s*:/.test(call), `scheduleJob[${idx}] passes a tz option`);
});

// 3. Make sure the legacy bare-string form is gone.
const bareStringCall = /scheduleJob\(\s*['"][\d \*\/,-]+['"]\s*,/.test(cronSrc);
assert(!bareStringCall, 'no scheduleJob still uses the bare cron-string form');

console.log('\nAll BUG-035 assertions passed.');
