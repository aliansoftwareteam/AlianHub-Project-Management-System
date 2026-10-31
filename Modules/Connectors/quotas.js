const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const usage = require('./usage');

const SCOPE = Object.freeze({ WORKSPACE: 'workspace', MEMBER: 'member', AGENT: 'agent' });
const DEFAULTS = Object.freeze({ reads: 500, writeProposals: 50, agentReads: 200 });
const FALLBACK_CEILINGS = Object.freeze({ reads: 5000, writeProposals: 500, agentReads: 2000 });
const FIELDS_OF = Object.freeze({
    [SCOPE.WORKSPACE]: ['reads', 'writeProposals', 'agentReads'],
    [SCOPE.MEMBER]: ['reads', 'writeProposals'],
    [SCOPE.AGENT]: ['agentReads'],
});
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const countFrom = (value, fallback) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

const ceilings = () => ({
    reads: countFrom(process.env.CONNECTOR_QUOTA_MAX_READS, FALLBACK_CEILINGS.reads),
    writeProposals: countFrom(process.env.CONNECTOR_QUOTA_MAX_WRITE_PROPOSALS, FALLBACK_CEILINGS.writeProposals),
    agentReads: countFrom(process.env.CONNECTOR_QUOTA_MAX_AGENT_READS, FALLBACK_CEILINGS.agentReads),
});

const isSet = (value) => value !== undefined && value !== null;

const limitsFor = async (companyId, userId, agentId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CONNECTOR_QUOTAS,
        data: [{ $or: [{ scope: SCOPE.WORKSPACE }, { scope: SCOPE.MEMBER, targetId: String(userId) }, { scope: SCOPE.AGENT, targetId: String(agentId) }] }],
    }, 'find');
    const rowOf = (scope) => (rows || []).find((row) => row.scope === scope) || {};
    const workspace = rowOf(SCOPE.WORKSPACE);
    const member = rowOf(SCOPE.MEMBER);
    const agent = rowOf(SCOPE.AGENT);
    const pick = (specific, field) => [specific[field], workspace[field], DEFAULTS[field]].find(isSet);
    const ceiling = ceilings();
    // A ceiling lowered after an override was saved still holds.
    return {
        reads: Math.min(pick(member, 'reads'), ceiling.reads),
        writeProposals: Math.min(pick(member, 'writeProposals'), ceiling.writeProposals),
        agentReads: Math.min(pick(agent, 'agentReads'), ceiling.agentReads),
    };
};

const overLimit = (who, limit, what) => {
    const resetsAt = usage.nextReset();
    const message = `${who} used today's ${limit} ${what}. It resets at ${resetsAt.toISOString()}.`;
    return Object.assign(new Error(`quota_reached: ${message}`), { code: 'quota_reached', deterministic: true, status: 429, limit, resetsAt });
};

/* Counted first and checked after, so two calls racing for the last place cannot both take it. The loser gives its count back. */
const claim = async (companyId, who, field, checks) => {
    const slot = { ...who, day: usage.dayOf() };
    await usage.add(companyId, slot, field, 1);
    const release = () => usage.add(companyId, slot, field, -1);
    for (const check of checks) {
        // eslint-disable-next-line no-await-in-loop
        if (await check.used(slot.day) > check.limit) {
            // eslint-disable-next-line no-await-in-loop
            await release();
            throw overLimit(check.who, check.limit, check.what);
        }
    }
    return { release };
};

const claimRead = async (companyId, who) => {
    const agentId = who.actor.type === 'agent' ? String(who.actor.id || '') : '';
    const limits = await limitsFor(companyId, who.userId, agentId);
    const field = usage.FIELD.READS;
    const what = 'reads from connected apps';
    const checks = [{ who: 'This person', what, limit: limits.reads, used: (day) => usage.usedByPerson(companyId, who.userId, day, field) }];
    if (agentId) checks.push({ who: 'This agent', what, limit: limits.agentReads, used: (day) => usage.usedByAgent(companyId, agentId, day, field) });
    return claim(companyId, who, field, checks);
};

const claimWriteProposal = async (companyId, who) => {
    const limits = await limitsFor(companyId, who.userId, '');
    const field = usage.FIELD.WRITE_PROPOSALS;
    return claim(companyId, who, field, [{ who: 'This person', what: 'write proposals to connected apps', limit: limits.writeProposals, used: (day) => usage.usedByPerson(companyId, who.userId, day, field) }]);
};

const badInput = (message) => Object.assign(new Error(message), { status: 400, expose: true });

const targetProblem = async (companyId, scope, targetId) => {
    if (scope === SCOPE.WORKSPACE) return '';
    if (!OBJECT_ID.test(targetId)) return `A ${scope} limit needs the ${scope}'s id.`;
    const found = scope === SCOPE.MEMBER
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: targetId, ...ACTIVE_SEAT }, { userId: 1 }] }, 'findOne')
        : await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: targetId }, { _id: 1 }] }, 'findOne');
    return found ? '' : `That ${scope} is not in this workspace.`;
};

const changesFrom = (scope, body) => {
    const fields = FIELDS_OF[scope];
    const stranger = Object.keys(DEFAULTS).find((field) => body[field] !== undefined && !fields.includes(field));
    if (stranger) throw badInput(`A ${scope} limit does not take ${stranger}.`);
    const named = fields.filter((field) => body[field] !== undefined);
    if (!named.length) throw badInput(`Name at least one of ${fields.join(', ')}.`);
    const ceiling = ceilings();
    named.filter((field) => body[field] !== null).forEach((field) => {
        if (!Number.isInteger(body[field]) || body[field] < 0) throw badInput(`${field} must be a whole number, 0 or more.`);
        if (body[field] > ceiling[field]) throw badInput(`${field} cannot be above this server's limit of ${ceiling[field]}.`);
    });
    return {
        set: Object.fromEntries(named.filter((field) => body[field] !== null).map((field) => [field, body[field]])),
        clear: Object.fromEntries(named.filter((field) => body[field] === null).map((field) => [field, ''])),
    };
};

/* `null` takes an override away, so the wider one or the default applies again. */
const set = async (companyId, body, actor) => {
    const scope = String(body.scope || '');
    if (!FIELDS_OF[scope]) throw badInput(`scope must be one of ${Object.values(SCOPE).join(', ')}.`);
    const targetId = scope === SCOPE.WORKSPACE ? '' : String(body.targetId || '');
    const problem = await targetProblem(companyId, scope, targetId);
    if (problem) throw badInput(problem);
    const changes = changesFrom(scope, body);
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CONNECTOR_QUOTAS,
        data: [
            { scope, targetId },
            { $set: { ...changes.set, setBy: String(actor.id), updatedAt: new Date() }, ...(Object.keys(changes.clear).length ? { $unset: changes.clear } : {}), $setOnInsert: { companyId: String(companyId) } },
            { upsert: true },
        ],
    }, 'updateOne');
    recordAudit(companyId, {
        actorId: String(actor.id), action: 'connector.quota_set', entityType: 'connector_quota', entityId: targetId || SCOPE.WORKSPACE, entityName: scope,
        meta: { scope, set: changes.set, cleared: Object.keys(changes.clear) }, ip: actor.ip,
    });
    const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CONNECTOR_QUOTAS, data: [{ scope, targetId }] }, 'findOne');
    return {
        scope, targetId,
        limits: Object.fromEntries(FIELDS_OF[scope].map((field) => [field, isSet(saved && saved[field]) ? saved[field] : null])),
        defaults: DEFAULTS, ceilings: ceilings(),
    };
};

module.exports = { SCOPE, DEFAULTS, ceilings, limitsFor, claimRead, claimWriteProposal, set };
