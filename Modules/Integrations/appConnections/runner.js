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
const ERROR_MAX = 300;

const audit = (companyId, connection, entry) => recordAudit(companyId, {
    ...AUDIT_ACTOR, entityType: 'integration', entityId: String(connection._id), entityName: connection.name || connection.type, ...entry,
});

const lastErrorOf = (results, truncated) => {
    if (truncated) return 'More changed than one check can read; the start point is kept so nothing is skipped.';
    return results.failed ? 'Some events could not be applied; see the audit log.' : '';
};

const CLEARED = Object.freeze({ errorCode: '', blockedHost: '' });

const actingUserOf = (connection) => String(connection.connectedBy || connection.createdBy || '');

const waitingOf = (targets, connector, config) => {
    if (!targets.length) return (connector.waiting && connector.waiting(config)) || 'No project is linked yet.';
    if (!targets.some((t) => t.linked.length)) return 'No project is linked yet.';
    return 'The person who connected this app can no longer open any linked project.';
};

const failureOf = (error, secrets) => {
    const blockedHost = unlistedHostOf(error);
    return { blockedHost, message: blockedHost ? backoff.egressBlockedMessage(blockedHost) : backoff.cleanError(error, secrets) };
};

/* Events are applied oldest first; an event that fails is recorded and not retried, because its comment or link may
 * already be written and a retry would act twice. A pull request's task keys are matched only in its repository's projects. */
async function pollTarget({ companyId, held, connector, config, target, actingUserId, now, get, secrets }) {
    const since = (target.sync && target.sync.cursor) || (held.connectedAt && new Date(held.connectedAt).toISOString()) || new Date(now).toISOString();
    const { events, cursor, truncated } = await connector.poll({ companyId, connection: held, config, repo: target.repo, since, get });
    const ctx = { companyId, connection: held, actingUserId, projectIds: target.projectIds, claim: state.claimer(companyId, held) };
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
    return { results, cursor: cursor || since, truncated };
}

/* A row that still holds one repository keeps its sync state on the row, as before the mapping. */
async function syncLegacy(args) {
    const { companyId, held, now } = args;
    const { results, cursor, truncated } = await pollTarget(args);
    await state.record(companyId, held._id, {
        cursor, lastSyncAt: new Date(now), lastError: lastErrorOf(results, truncated),
        failures: 0, nextAttemptAt: null, lockUntil: null, lastEvents: results.events, ...CLEARED,
    });
    if (results.events) audit(companyId, held, { action: 'app_connection.sync', meta: { events: results.events, acted: results.acted, failed: results.failed } });
    return results;
}

/* Each repository has its own cursor and backoff, so one that fails waits alone. The row keeps a summary:
 * it backs off only while every repository does. */
async function syncMapped({ companyId, held, connector, config, targets, actingUserId, now, get, secrets }) {
    const totals = { events: 0, acted: 0, failed: 0, repos: {} };
    const problems = [];
    const waits = [];
    let healthy = 0;
    for (const target of targets) {
        if (!backoff.isDue(target.sync, now)) {
            waits.push(new Date(target.sync.nextAttemptAt).getTime());
            problems.push({ repo: target.repo, message: target.sync.lastError || '', blockedHost: target.sync.blockedHost || '', failures: Number(target.sync.failures) || 0 });
            totals.repos[target.repo] = { skipped: true, backoff: true };
            continue;
        }
        try {
            const { results, cursor, truncated } = await pollTarget({ companyId, held, connector, config, target, actingUserId, now, get, secrets });
            const lastError = lastErrorOf(results, truncated);
            await state.recordRepo(companyId, held._id, target.repo, {
                cursor, lastSyncAt: new Date(now), lastError, failures: 0, nextAttemptAt: null, lastEvents: results.events, ...CLEARED,
            });
            if (lastError) problems.push({ repo: target.repo, message: lastError, blockedHost: '', failures: 0 });
            healthy += 1;
            totals.events += results.events;
            totals.acted += results.acted;
            totals.failed += results.failed;
            totals.repos[target.repo] = results;
            if (results.events) audit(companyId, held, { action: 'app_connection.sync', meta: { repo: target.repo, events: results.events, acted: results.acted, failed: results.failed } });
        } catch (error) {
            const failures = Number((target.sync && target.sync.failures) || 0) + 1;
            const { message, blockedHost } = failureOf(error, secrets);
            const nextAttemptAt = backoff.nextAttempt(error, failures, now);
            await state.recordRepo(companyId, held._id, target.repo, {
                lastError: message, errorCode: blockedHost ? backoff.EGRESS_BLOCKED : '', blockedHost, failures, nextAttemptAt: new Date(nextAttemptAt),
            }).catch((e) => logger.error(`[appConnections] could not record a failure for ${held._id} ${target.repo}: ${e.message}`));
            audit(companyId, held, { action: 'app_connection.error', meta: { repo: target.repo, message, failures } });
            problems.push({ repo: target.repo, message, blockedHost, failures });
            waits.push(nextAttemptAt);
            totals.repos[target.repo] = { error: message, failures };
        }
    }
    const blocked = problems.find((p) => p.blockedHost);
    await state.record(companyId, held._id, {
        lastSyncAt: new Date(now), lockUntil: null,
        lastError: problems.filter((p) => p.message).map((p) => `${p.repo}: ${p.message}`).join(' ').slice(0, ERROR_MAX),
        errorCode: blocked ? backoff.EGRESS_BLOCKED : '', blockedHost: blocked ? blocked.blockedHost : '',
        failures: healthy ? 0 : Math.max(0, ...problems.map((p) => p.failures)),
        nextAttemptAt: !healthy && waits.length ? new Date(Math.min(...waits)) : null,
    });
    return totals;
}

async function syncConnection({ companyId, connection, now = Date.now(), get }) {
    const connector = registry.get(connection.type);
    if (!connector || connection.enabled === false) return { skipped: true };
    if (!backoff.isDue(connection.sync, now)) return { skipped: true, backoff: true };
    const held = await state.lease(companyId, connection, now);
    if (!held) return { skipped: true, leased: true };

    const secrets = [];
    try {
        const actingUserId = actingUserOf(held);
        const visible = actingUserId ? new Set(await visibleProjectIds(companyId, actingUserId)) : new Set();
        const targets = connector.targets(held).map((t) => ({ ...t, linked: t.projectIds, projectIds: t.projectIds.filter((id) => visible.has(id)) }));
        const live = targets.filter((t) => t.projectIds.length);
        if (!live.length) {
            const waiting = waitingOf(targets, connector, held.config || {});
            await state.record(companyId, held._id, { cursor: new Date(now).toISOString(), lastSyncAt: new Date(now), lockUntil: null, lastError: waiting, failures: 0, nextAttemptAt: null, ...CLEARED });
            return { events: 0, projects: 0 };
        }

        const config = await H.openSecrets({ companyId, row: held });
        R.secretKeys(held.type).forEach((key) => secrets.push(config[key]));
        const args = { companyId, held, connector, config, actingUserId, now, get, secrets };
        if (live.length === 1 && live[0].legacy) return await syncLegacy({ ...args, target: live[0] });
        return await syncMapped({ ...args, targets: live });
    } catch (error) {
        const failures = Number((held.sync && held.sync.failures) || 0) + 1;
        const { message, blockedHost } = failureOf(error, secrets);
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
