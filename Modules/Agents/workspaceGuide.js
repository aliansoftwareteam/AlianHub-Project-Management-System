const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isOn } = require('../Mcp/defaultOn');
const logger = require('../../Config/loggerConfig');
const agentRecord = require('./agentRecord');
const agentAudit = require('./agentAudit');
const projectGuide = require('./skills/seeds/projectGuide');

const KEY = 'workspace-guide';
const NAME = 'Workspace Guide';
const DESCRIPTION = 'Answers "what next" on any task from its project\'s plan. Mention it in a comment; it only reads, comments and proposes.';
const SKILL = Object.freeze({ key: projectGuide.key, name: projectGuide.name, enabled: true });
const ACTIONS = Object.freeze(['task.get', 'task.comment', 'subtask.create']);
const AUTONOMY = 1;
const MADE_BY = `built-in:${KEY}`;

const STATE = Object.freeze({ MISSING: 'missing', PRESENT: 'present', REMOVED: 'removed' });

// WORKSPACE_GUIDE_AUTO_CREATE=false leaves new workspaces without one until an admin adds it.
const autoCreateOn = () => isOn(process.env.WORKSPACE_GUIDE_AUTO_CREATE);

const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const find = async (companyId) => plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ builtIn: KEY }] }, 'findOne'));

const stateOf = async (companyId) => {
    const row = await find(companyId);
    if (!row) return STATE.MISSING;
    return row.deletedStatusKey === 1 ? STATE.REMOVED : STATE.PRESENT;
};

/* The row is its own lock: builtIn is unique per company, so of two concurrent calls one saves and the other reads
 * the winner. A deleted row stays, which is what stops a removed guide from being made again. */
const ensureWorkspaceAgent = async (companyId, { ownerId, actor } = {}) => {
    const existing = await find(companyId);
    if (existing) return { agent: existing, created: false, state: existing.deletedStatusKey === 1 ? STATE.REMOVED : STATE.PRESENT };
    try {
        const saved = await agentRecord.createAgentRecord(companyId, {
            name: NAME,
            slug: KEY,
            description: DESCRIPTION,
            skills: [SKILL],
            allowedActions: [...ACTIONS],
            autonomy: AUTONOMY,
            trigger: 'mention',
            builtIn: KEY,
            madeBy: MADE_BY,
        }, { ownerId });
        const made = plain(saved);
        await agentAudit.recordAgentCreated(companyId, actor || { kind: 'human', userId: String(ownerId || '') }, { agentId: made._id, agentName: made.name, madeBy: MADE_BY });
        return { agent: made, created: true, state: STATE.PRESENT };
    } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        const winner = await find(companyId);
        return { agent: winner, created: false, state: winner && winner.deletedStatusKey === 1 ? STATE.REMOVED : STATE.PRESENT };
    }
};

/* Called when a workspace is made; it never stops the creation. */
const onCompanyCreated = async (companyId, ownerId) => {
    if (!autoCreateOn()) return { skipped: true };
    try {
        return await ensureWorkspaceAgent(companyId, { ownerId });
    } catch (e) {
        logger.error(`workspace guide for ${companyId}: ${e.message}`);
        return { failed: true };
    }
};

module.exports = { KEY, NAME, ACTIONS, AUTONOMY, MADE_BY, STATE, autoCreateOn, stateOf, ensureWorkspaceAgent, onCompanyCreated };
