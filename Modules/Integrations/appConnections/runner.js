const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const state = require('./syncState');
const logger = require('../../../Config/loggerConfig');
const { recordAudit } = require('../../Audit/recorder');
const { visibleProjectIds } = require('../../Agents/scope');
const H = require('../helpers/secretHandles');
const R = require('../helpers/integrationsRules');
const registry = require('./registry');
const backoff = require('./backoff');
const { unlistedHostOf } = require('../../Agents/engine/safeFetch');

const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const AUDIT_ACTOR = { actorId: 'integration', actorName: 'App connections' };

const audit = (companyId, connection, entry) => recordAudit(companyId, {
    ...AUDIT_ACTOR, entityType: 'integration', entityId: String(connection._id), entityName: connection.name || connection.type, ...entry,
});

const lastErrorOf = (results, truncated) => {
    if (truncated) return 'More changed than one check can read; the start point is kept so nothing is skipped.';
    return results.failed ? 'Some events could not be applied; see the audit log.' : '';
};

const CLEARED = Object.freeze({ errorCode: '', blockedHost: '' });

const actingUserOf = (connection) => String(connection.connectedBy || connection.createdBy || '');

/* One connection, one poll. Events are applied oldest first; an event that fails is recorded and not retried,
 * because its comment or link may already be written and a retry would act twice. */
async function syncConnection({ companyId, connection, now = Date.now(), get }) {
    const connector = registry.get(connection.type);
    if (!connector || connection.enabled === false) return { skipped: true };
    if (!backoff.isDue(connection.sync, now)) return { skipped: true, backoff: true };
    const held = await state.lease(companyId, connection, now);
    if (!held) return { skipped: true, leased: true };

    const secrets = [];
    try {
        const actingUserId = actingUserOf(held);
        const linked = Array.isArray(held.projectIds) ? held.projectIds.map(String) : [];
        const visible = actingUserId ? new Set(await visibleProjectIds(companyId, actingUserId)) : new Set();
        const projectIds = linked.filter((id) => visible.has(id));
        const unlinked = linked.length ? 'The person who connected this app can no longer open any linked project.' : 'No project is linked yet.';
        const waiting = projectIds.length ? (connector.waiting && connector.waiting(held.config || {})) || '' : unlinked;
        if (waiting) {
            await state.record(companyId, held._id, { cursor: new Date(now).toISOString(), lastSyncAt: new Date(now), lockUntil: null, lastError: waiting, failures: 0, nextAttemptAt: null, ...CLEARED });
            return { events: 0, projects: projectIds.length };
        }

        const config = await H.openSecrets({ companyId, row: held });
        R.secretKeys(held.type).forEach((key) => secrets.push(config[key]));
        const since = (held.sync && held.sync.cursor) || (held.connectedAt && new Date(held.connectedAt).toISOString()) || new Date(now).toISOString();
        const { events, cursor, truncated } = await connector.poll({ companyId, connection: held, config, since, get });

        const ctx = { companyId, connection: held, actingUserId, projectIds, claim: state.claimer(companyId, held) };
        const results = { events: events.length, acted: 0, failed: 0 };
        for (const event of events) {
            try {
                const done = await connector.handle(ctx, event);
                for (const item of done) {
                    results.acted += 1;
                    audit(companyId, held, { action: item.action, meta: { ...item.meta, taskKey: item.task.TaskKey, taskId: String(item.task._id), eventKey: event.key } });
                }
            } catch (error) {
                results.failed += 1;
                audit(companyId, held, { action: 'app_connection.error', meta: { eventKey: event.key, message: backoff.cleanError(error, secrets) } });
            }
        }

        await state.record(companyId, held._id, {
            cursor: cursor || since, lastSyncAt: new Date(now), lastError: lastErrorOf(results, truncated),
            failures: 0, nextAttemptAt: null, lockUntil: null, lastEvents: results.events, ...CLEARED,
        });
        if (results.events) audit(companyId, held, { action: 'app_connection.sync', meta: { events: results.events, acted: results.acted, failed: results.failed } });
        return results;
    } catch (error) {
        const failures = Number((held.sync && held.sync.failures) || 0) + 1;
        const blockedHost = unlistedHostOf(error);
        const message = blockedHost ? backoff.egressBlockedMessage(blockedHost) : backoff.cleanError(error, secrets);
        await state.record(companyId, held._id, {
            lastError: message, errorCode: blockedHost ? backoff.EGRESS_BLOCKED : '', blockedHost, failures, nextAttemptAt: new Date(backoff.nextAttempt(error, failures, now)), lockUntil: null,
        }).catch((e) => logger.error(`[appConnections] could not record a failure for ${held._id}: ${e.message}`));
        audit(companyId, held, { action: 'app_connection.error', meta: { message, failures } });
        return { error: message, failures };
    }
}

async function syncCompany(companyId, opts = {}) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: T, data: [{ type: { $in: registry.types() }, enabled: true, deletedStatusKey: { $ne: 1 } }],
    }, 'find');
    const out = [];
    for (const connection of rows || []) out.push(await syncConnection({ companyId, connection, ...opts }));
    return out;
}

module.exports = { syncConnection, syncCompany };
