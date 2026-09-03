const { Agenda } = require('@hokify/agenda');
const logger = require('../../../../Config/loggerConfig');

// Agenda driver — ONE instance, on the global database.
//
// This deviates from the obvious reading of "every engine table lives in the
// tenant DB", and deliberately. mongoConnector opens a pool of 10 PER COMPANY;
// an Agenda instance per tenant means one poller, one connection and one timer
// per tenant, so 500 companies would be 500 pollers before a single rule runs.
// That is the connection-pool exhaustion risk in ADR 002's own risk table.
//
// So: the job row lives in global and carries companyId. The RUN document — the
// durable record of what happened, and the thing users read — still lives in the
// tenant database. The trade is that a tenant restore does not restore that
// tenant's in-flight jobs; it does restore every completed run. In-flight jobs
// live for seconds, and an interrupted run is visible as `running` with a cursor,
// so it can be retried. Losing a completed run would matter; losing a queue slot
// does not.

const JOB_COLLECTION = 'automation_jobs';
const DEFAULT_CONCURRENCY = 5;

const createAgendaDriver = ({ mongoUrl, dbName = 'global', concurrency = DEFAULT_CONCURRENCY } = {}) => {
    let agenda = null;
    let running = false;
    const pendingDefinitions = new Map();

    const address = () => {
        const base = String(mongoUrl || process.env.MONGODB_URL || '').replace(/\/+$/, '');
        if (!base) throw new Error('MONGODB_URL is not set — the agenda driver cannot connect');
        return `${base}/${dbName}`;
    };

    return {
        name: 'agenda',
        isRunning: () => running,

        define(name, handler) {
            pendingDefinitions.set(name, handler);
            if (agenda) agenda.define(name, handler, { concurrency });
        },

        async start() {
            if (running) return;
            agenda = new Agenda({
                db: { address: address(), collection: JOB_COLLECTION },
                // Long enough that a slow action does not get its lock stolen and
                // run twice; short enough that a crashed worker frees work.
                defaultLockLifetime: 5 * 60 * 1000,
                maxConcurrency: concurrency * 4,
            });
            pendingDefinitions.forEach((handler, name) => agenda.define(name, handler, { concurrency }));
            await agenda.start();
            running = true;
            logger.info(`[automation-queue] agenda started on ${dbName}.${JOB_COLLECTION} (concurrency=${concurrency})`);
        },

        async stop() {
            if (!agenda) return;
            await agenda.stop();
            running = false;
        },

        async enqueue(name, data, opts = {}) {
            if (!agenda) throw new Error('agenda driver not started');
            if (opts.runAt) return agenda.schedule(opts.runAt, name, data);
            return agenda.now(name, data);
        },
    };
};

module.exports = { createAgendaDriver, JOB_COLLECTION };
