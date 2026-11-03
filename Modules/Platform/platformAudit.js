const logger = require('../../Config/loggerConfig');

const SUMMARY_MAX = 500;

let sink = (row) => {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('../../Config/schemaType');
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.PLATFORM_AUDIT, data: row }, 'save');
};

/* Fire-and-forget: a failed audit write is logged and never fails the call it records. The row
 * holds what was done and a summary the handler wrote, never the request body. */
function logCall({ action, requestId = '', ok, summary = '', durationMs = 0, at = new Date() }) {
    const row = { at, action: String(action), requestId: String(requestId || '').slice(0, 200), ok: Boolean(ok), summary: String(summary || '').slice(0, SUMMARY_MAX), durationMs: Math.max(0, Math.round(durationMs)) };
    const line = `[platform] ${row.action} ok=${row.ok}${row.requestId ? ` request=${row.requestId}` : ''}${row.summary ? ` ${row.summary}` : ''}`;
    if (row.ok) logger.info(line); else logger.warn(line);
    return Promise.resolve()
        .then(() => sink(row))
        .catch((error) => logger.error(`[platform] audit row ${row.action} not written: ${error && error.message ? error.message : error}`));
}

/* Writes one row when the response finishes; the handler names what happened in req.platform.summary. */
const audited = (action, handler) => (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => logCall({
        action: (req.platform && req.platform.action) || action,
        requestId: req.platform && req.platform.requestId,
        ok: res.statusCode < 400,
        summary: (req.platform && req.platform.summary) || (res.statusCode >= 400 ? `HTTP ${res.statusCode}` : ''),
        durationMs: Date.now() - startedAt,
    }));
    return handler(req, res, next);
};

module.exports = { logCall, audited, _useSinkForTests: (next) => { sink = next; } };
