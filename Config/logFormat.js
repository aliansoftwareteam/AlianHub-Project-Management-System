const { format } = require('winston');
const { requestId } = require('./requestContext');
const { traceIdNow } = require('./telemetry');

const textLine = ({ level, message, label, timestamp }) => {
    const rid = requestId();
    const tid = traceIdNow();
    return `${timestamp} [${label}] ${level}:${rid ? ` [${rid}]` : ''}${tid ? ` [trace=${tid}]` : ''} ${message}`;
};

const jsonLine = ({ level, message, label, timestamp }) => JSON.stringify({
    ts: timestamp, level, label, requestId: requestId() || null, traceId: traceIdNow() || null, message,
});

const formatFor = (kind = process.env.LOG_FORMAT || 'text') => format.combine(
    format.label({ label: 'log' }),
    format.timestamp(),
    format.printf(String(kind).toLowerCase() === 'json' ? jsonLine : textLine),
);

module.exports = { formatFor, textLine, jsonLine };
