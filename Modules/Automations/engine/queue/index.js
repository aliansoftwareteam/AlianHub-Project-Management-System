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
 *   isRunning()
 */

const INLINE = 'inline';

/* Runs handlers immediately, in-process, with no persistence. For tests and for
 * a self-host instance that has not opted into a queue — never for production
 * scheduling, because nothing survives a restart. */
const createInlineDriver = () => {
    const handlers = new Map();
    let running = false;
    return {
        name: INLINE,
        async start() { running = true; },
        async stop() { running = false; handlers.clear(); },
        isRunning: () => running,
        define(name, handler) { handlers.set(name, handler); },
        async enqueue(name, data, opts = {}) {
            const handler = handlers.get(name);
            if (!handler) throw new Error(`no handler defined for job "${name}"`);
            const delay = opts.runAt ? Math.max(0, opts.runAt.getTime() - Date.now()) : 0;
            if (!delay) return handler({ attrs: { data } });
            return new Promise((resolve, reject) => {
                setTimeout(() => { handler({ attrs: { data } }).then(resolve, reject); }, delay);
            });
        },
    };
};

module.exports = { createInlineDriver, INLINE };
