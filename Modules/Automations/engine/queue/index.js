/* QueueAdapter — the seam that keeps the durable-queue choice reversible.
 *
 * ADR 002 picks Agenda on MongoDB because it adds no service to a compose file
 * that ships exactly `app` + `mongo`. Agenda polls, so past roughly 50 runs/sec
 * it strains; if we ever measure that load, a BullMQ driver slots in here and no
 * action, rule or runner line changes. That is the whole reason this interface
 * exists — not because we expect to switch, but because discovering we cannot is
 * the expensive outcome.
 *
 * A driver implements:
 *   start()                       — connect and begin processing
 *   stop()                        — drain and disconnect
 *   define(name, handler)         — register a job handler
 *   enqueue(name, data, opts)     — schedule work; opts.runAt for delays
 *   every(intervalMs, name)       — run a defined job on a fixed interval
 *   isRunning()
 */

const logger = require('../../../../Config/loggerConfig');

const INLINE = 'inline';

/* Runs handlers in-process, with no persistence. For tests and for a self-host
 * instance that has not opted into a queue — never for production scheduling,
 * because nothing survives a restart.
 *
 * An immediate job runs before enqueue returns; a delayed one is only booked, as
 * Agenda books it. A waiting workflow step books its next look on every look, so
 * awaiting it would hold the request that moved the run for as long as the step
 * waits. */
const createInlineDriver = () => {
    const handlers = new Map();
    const timers = new Set();
    let running = false;
    return {
        name: INLINE,
        async start() { running = true; },
        async stop() { running = false; handlers.clear(); timers.forEach(clearTimeout); timers.clear(); },
        isRunning: () => running,
        define(name, handler) { handlers.set(name, handler); },
        async every(intervalMs, name) {
            const handler = handlers.get(name);
            if (!handler) throw new Error(`no handler defined for job "${name}"`);
            const timer = setInterval(() => { handler({ attrs: { data: {} } }).catch(() => {}); }, intervalMs);
            if (timer.unref) timer.unref();
            timers.add(timer);
        },
        async enqueue(name, data, opts = {}) {
            const handler = handlers.get(name);
            if (!handler) throw new Error(`no handler defined for job "${name}"`);
            const delay = opts.runAt ? Math.max(0, opts.runAt.getTime() - Date.now()) : 0;
            if (!delay) return handler({ attrs: { data } });
            const timer = setTimeout(() => {
                timers.delete(timer);
                handler({ attrs: { data } }).catch((error) => logger.error(`[automation-queue] delayed job "${name}" failed: ${error.message}`));
            }, delay);
            if (timer.unref) timer.unref();
            timers.add(timer);
            return undefined;
        },
    };
};

module.exports = { createInlineDriver, INLINE };
