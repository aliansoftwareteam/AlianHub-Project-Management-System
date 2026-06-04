/**
 * Tiny SSE emitter for proposal-review progress — same pattern as
 * Modules/AIProjectGenerator/sseEmitter.js. `emit(reviewId, payload)` pushes a
 * payload to whoever is streaming that reviewId; `handleEvents(req, res)` opens
 * the SSE stream. The stream closes itself on a `complete` / `error` event.
 */
'use strict';

const events = require('events');

const eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(200);

function emit(reviewId, payload) {
    if (!reviewId) return;
    eventEmitter.emit(reviewId, payload);
}

function handleEvents(req, res) {
    try {
        const reviewId = req.params && req.params.reviewId;
        if (!reviewId) {
            res.status(400).send({ status: false, statusText: 'reviewId required' });
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
        const cleanup = () => { eventEmitter.off(reviewId, onPayload); };
        eventEmitter.on(reviewId, onPayload);

        const hb = setInterval(() => {
            try { res.write(`: ping\n\n`); } catch (_e) { /* ignore */ }
        }, 25000);

        req.on('close', () => { clearInterval(hb); cleanup(); });
    } catch (error) {
        try { res.status(500).send({ status: false, statusText: error.message }); } catch (_e) { /* ignore */ }
    }
}

module.exports = { emit, handleEvents };
