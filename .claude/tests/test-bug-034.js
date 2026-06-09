/**
 * BUG-034 regression — Winston log rotation.
 *
 * Pre-fix: Config/loggerConfig.js wired three `transports.File`
 * instances (no rotation). The files grew unbounded → disk fill →
 * crash.
 *
 * Post-fix: each file transport is replaced with a
 * `winston-daily-rotate-file` (DailyRotateFile) transport with a
 * size cap (`maxSize`) and retention window (`maxFiles`).
 *
 * We can't easily assert disk-rotation behaviour at the unit level,
 * but we can introspect the logger object and confirm:
 *   1. It has exactly three transports.
 *   2. Every transport is a DailyRotateFile (carries the
 *      rotation-specific fields).
 *   3. Each transport has a sensible `maxSize` and `maxFiles`.
 *   4. The filenames still match the legacy basenames so log-aggregators
 *      grepping for `error.log` / `combined.log` keep working
 *      (DailyRotateFile splices the date suffix in).
 */

const path = require('path');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const logger = require(path.resolve(__dirname, '../../Config/loggerConfig.js'));

const fileTransports = logger.transports || [];
assert(fileTransports.length === 3, 'logger has three transports');

const DailyRotateFile = require('winston-daily-rotate-file');

fileTransports.forEach((t, idx) => {
    assert(t instanceof DailyRotateFile, `transport[${idx}] is a DailyRotateFile`);
    assert(t.options && typeof t.options.maxSize !== 'undefined', `transport[${idx}] has a maxSize cap`);
    assert(t.options && typeof t.options.maxFiles !== 'undefined', `transport[${idx}] has a maxFiles retention window`);
});

// Spot-check the filenames carry the legacy basenames.
const filenames = fileTransports.map(t => t.filename || '');
assert(filenames.some(f => f.includes('track')), 'a transport targets track-*.log');
assert(filenames.some(f => f.includes('error')), 'a transport targets error-*.log');
assert(filenames.some(f => f.includes('combined')), 'a transport targets combined-*.log');

// Levels are preserved.
const levels = fileTransports.map(t => t.level).filter(Boolean);
assert(levels.includes('warn'), 'warn-level transport present');
assert(levels.includes('error'), 'error-level transport present');
assert(levels.includes('info'), 'info-level transport present');

console.log('\nAll BUG-034 assertions passed.');
