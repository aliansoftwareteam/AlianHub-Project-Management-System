const { createLogger } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { formatFor } = require('./logFormat');

// BUG-034 / #88: rotated so long-running deployments do not fill the disk.
const LOG_DIR = process.env.LOG_DIR || 'log';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';
const LOG_DATE_PATTERN = process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD';

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

const logger = createLogger({
    format: formatFor(process.env.LOG_FORMAT || 'text'),
    transports: [
        // Legacy basenames keep existing tail/grep ops and Modules/Instance/logsPath working.
        rotatingTransport('track-%DATE%.log', 'warn'),
        rotatingTransport('error-%DATE%.log', 'error'),
        rotatingTransport('combined-%DATE%.log', 'info'),
    ]
})

const closeTransport = (transport) => new Promise((resolve) => {
    if (typeof transport.close !== 'function' || !transport.logStream) return resolve();
    transport.once('finish', resolve);
    transport.close();
});

require('./processGuards').onFatal('logger', () => Promise.all(logger.transports.map(closeTransport)), { last: true });

module.exports = logger;
