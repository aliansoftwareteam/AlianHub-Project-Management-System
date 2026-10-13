const flushers = new Map();
let installed = false;
let fatalInProgress = false;

const describeError = (err) => (err && err.stack ? err.stack : String(err));

function logError(line) {
    console.error(line);
    try {
        require('./loggerConfig').error(line);
    } catch (logErr) {
        console.error(`[FATAL] logger unavailable: ${describeError(logErr)}`);
    }
}

function flushTimeoutMs() {
    const ms = Number(process.env.FATAL_FLUSH_TIMEOUT_MS || 3000);
    return Number.isFinite(ms) && ms >= 0 ? ms : 3000;
}

/**
 * Registers an async flusher that fatal() awaits before exiting. `last` flushers
 * start once the others settle: the logger closes after a report has had its
 * chance to log a failure.
 */
function onFatal(name, fn, { last = false } = {}) {
    flushers.set(name, { fn, last });
    return () => flushers.delete(name);
}

function runFlushers(entries, err, origin, pending) {
    return Promise.all(entries.map(([name, { fn }]) => {
        pending.add(name);
        return Promise.resolve()
            .then(() => fn(err, origin))
            .catch((flushErr) => console.error(`[FATAL] flusher ${name} failed: ${describeError(flushErr)}`))
            .finally(() => pending.delete(name));
    }));
}

async function fatal(err, origin = 'uncaughtException') {
    if (fatalInProgress) {
        console.error(`[FATAL] ${origin} while flushing, exiting now: ${describeError(err)}`);
        process.exit(1);
        return;
    }
    fatalInProgress = true;
    logError(`[FATAL] ${origin}: ${describeError(err)}`);

    const entries = [...flushers];
    const pending = new Set();
    const cap = flushTimeoutMs();
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(true), cap); });
    const flushed = runFlushers(entries.filter(([, f]) => !f.last), err, origin, pending)
        .then(() => runFlushers(entries.filter(([, f]) => f.last), err, origin, pending))
        .then(() => false);

    if (await Promise.race([flushed, timedOut])) {
        console.error(`[FATAL] flush cut off after ${cap}ms, still pending: ${[...pending].join(', ')}`);
    }
    clearTimeout(timer);
    process.exit(1);
}

function onUnhandledRejection(reason) {
    const line = `[unhandledRejection] ${describeError(reason)}`;
    console.error(line);
    try {
        require('./loggerConfig').error(line);
    } catch (logErr) {
        console.error(`[unhandledRejection] logger unavailable: ${describeError(logErr)}`);
    }
}

function install() {
    if (installed) return;
    installed = true;
    process.on('uncaughtException', (err, origin) => fatal(err, origin));
    // Logged, not fatal: exiting turned every handler that forgot to answer (an
    // unhandled rejection from a bad request body) into a process kill anyone
    // could trigger over HTTP. An uncaught exception still exits: that is corrupted state.
    process.on('unhandledRejection', onUnhandledRejection);
}

module.exports = { install, onFatal, fatal };
