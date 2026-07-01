const events = require('events');

const eventEmitter = new events.EventEmitter();
// Allow more listeners — multiple SSE clients per node could subscribe to
// different jobIds at the same time.
eventEmitter.setMaxListeners(200);

const COMPLETE_EVENT = '__COMPLETE__';

// Buffer events emitted before any subscriber attaches, then replay them when
// one connects. Without this, a job that finishes faster than the client's
// EventSource can connect (e.g. the quick tasks-only execute) loses its
// terminal 'complete'/'error' event and the UI spins forever. Buffers are
// bounded and dropped after a TTL if nobody ever connects.
const buffers = new Map();          // jobId -> payload[]
const BUFFER_TTL_MS = 120000;
const MAX_BUFFERED = 500;

/**
 * Emit a progress payload to whoever is listening on `jobId`. If no subscriber
 * has connected yet, the payload is buffered and replayed on connect.
 * @param {string} jobId
 * @param {object} payload
 */
function emit(jobId, payload) {
    if (!jobId) return;
    if (eventEmitter.listenerCount(jobId) > 0) {
        eventEmitter.emit(jobId, payload);
        return;
    }
    let buf = buffers.get(jobId);
    if (!buf) {
        buf = [];
        buffers.set(jobId, buf);
        const t = setTimeout(() => buffers.delete(jobId), BUFFER_TTL_MS);
        if (t && typeof t.unref === 'function') t.unref();
    }
    if (buf.length < MAX_BUFFERED) buf.push(payload);
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

        // Replay anything emitted before this subscriber connected (fast jobs).
        // Synchronous, so no fresh emit can interleave between attach and flush.
        const pending = buffers.get(jobId);
        if (pending && pending.length) {
            buffers.delete(jobId);
            for (const p of pending) onPayload(p);
        }
    } catch (error) {
        try { res.status(500).send({ status: false, statusText: error.message }); } catch (_e) { /* ignore */ }
    }
}

module.exports = {
    emit,
    handleEvents,
    COMPLETE_EVENT,
};
