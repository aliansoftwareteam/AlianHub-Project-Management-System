const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { combine, timestamp, label, printf } = format;

const myFormat = printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${label}] ${level}: ${message}`;
});

// BUG-034 / #88 — rotate log files so they don't grow unbounded and fill
// disk on long-running deployments. Knobs are environment-tunable so
// operators can right-size for their disk/retention needs without code
// changes; the defaults match typical SaaS practice (20MB per file,
// 14-day retention).
const LOG_DIR = process.env.LOG_DIR || 'log';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';      // per file
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';    // retention window
const LOG_DATE_PATTERN = process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD';

/**
 * Build a DailyRotateFile transport. `%DATE%` in the filename is
 * expanded by winston-daily-rotate-file using LOG_DATE_PATTERN.
 * `zippedArchive: true` gzips rotated files so old logs sit on disk
 * cheaply.
 */
function rotatingTransport(filenameTemplate, level) {
    return new DailyRotateFile({
        filename: `${LOG_DIR}/${filenameTemplate}`,
        datePattern: LOG_DATE_PATTERN,
        zippedArchive: true,
        maxSize: LOG_MAX_SIZE,
        maxFiles: LOG_MAX_FILES,
        level
    });
}

module.exports = createLogger({
    format: combine(
        label({ label: 'log' }),
        timestamp(),
        myFormat
    ),
    transports: [
        // Filenames keep the legacy basenames (`track`, `error`,
        // `combined`) so existing tail/grep ops continue to find them;
        // the date suffix is appended by the rotator.
        rotatingTransport('track-%DATE%.log', 'warn'),
        rotatingTransport('error-%DATE%.log', 'error'),
        rotatingTransport('combined-%DATE%.log', 'info'),
    ]
})
