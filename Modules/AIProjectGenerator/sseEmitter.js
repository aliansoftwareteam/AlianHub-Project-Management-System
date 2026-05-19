const events = require('events');

const eventEmitter = new events.EventEmitter();
// Allow more listeners — multiple SSE clients per node could subscribe to
// different jobIds at the same time.
eventEmitter.setMaxListeners(200);

const COMPLETE_EVENT = '__COMPLETE__';

/**
 * Emit a progress payload to whoever is listening on `jobId`.
 * @param {string} jobId
 * @param {object} payload
 */
function emit(jobId, payload) {
    if (!jobId) return;
    eventEmitter.emit(jobId, payload);
}

/**
 * Express handler that opens an SSE stream for a jobId.
 * Mirrors the pattern in Modules/AI/eventController.js / Modules/Company/eventController.js
 */
function handleEvents(req, res) {
    try {
        const jobId = req.params && req.params.jobId;
        if (!jobId) {
            res.status(400).send({ status: false, statusText: 'jobId required' });
            return;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders && res.flushHeaders();

        const onPayload = (payload) => {
            try {
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
                if (payload && (payload.event === 'complete' || payload.event === 'error')) {
                    cleanup();
                    res.end();
                }
            } catch (e) {
                cleanup();
                try { res.end(); } catch (_e) { /* ignore */ }
            }
        };

        const cleanup = () => {
            eventEmitter.off(jobId, onPayload);
        };

        eventEmitter.on(jobId, onPayload);

        // Heartbeat to keep proxies from closing the connection.
        const hb = setInterval(() => {
            try { res.write(`: ping\n\n`); } catch (_e) { /* ignore */ }
        }, 25000);

        req.on('close', () => {
            clearInterval(hb);
            cleanup();
        });
    } catch (error) {
        try { res.status(500).send({ status: false, statusText: error.message }); } catch (_e) { /* ignore */ }
    }
}

module.exports = {
    emit,
    handleEvents,
    COMPLETE_EVENT,
};
