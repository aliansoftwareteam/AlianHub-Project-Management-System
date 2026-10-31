const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const tools = require('./tools');
const runner = require('./toolRunner');

/* A write to a connected app is filed as a proposal that only the connection's owner approves, and is sent once,
 * with exactly the params that owner saw on its card (FR-21 to FR-23 of task 056). */

const GATE = tools.WRITE_GATE;
const CARD_TEXT_MAX = 20000;
const CARD_LINE_MAX = 300;
const ATTACHMENTS_MAX = 20;
const ERROR_MAX = 300;
const REFUSAL = Object.freeze({
    NOT_OWNER: 'Only the person whose connection this is can approve it. It stays waiting for them.',
    NO_OWNER: 'A write to a connected app needs the person whose connection it uses.',
    NOT_FROM_PROPOSAL: 'A write to a connected app is sent only from a proposal its owner approved.',
    SENT_ONCE: 'This approval was already used to send, so it is not sent again. Ask for a new one.',
    TOKEN_FILED: 'A write to a connected app is proposed only by an agent run or an MCP call, not through this route.',
});

const refuse = (message, code, status = 403) => Object.assign(new Error(message), { status, code, deterministic: true });

const isWrite = (action) => tools.isWrite(action);
const hasWrite = (changes) => (Array.isArray(changes) ? changes : []).some((c) => c && isWrite(c.action));

const line = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();

/* The params are sent whole, so a card that had to cut anything would show less than goes out: such a write is refused. */
const partTooLong = (card) => {
    if (card.target.length > CARD_LINE_MAX) return 'target';
    if (card.title.length > CARD_LINE_MAX) return 'title';
    if (card.text.length > CARD_TEXT_MAX) return 'text';
    if (card.attachments.length > ATTACHMENTS_MAX || card.attachments.some((name) => name.length > CARD_LINE_MAX)) return 'attachments';
    return '';
};

const cardOf = (tool, args) => {
    const shown = tool.card(args) || {};
    const card = {
        provider: tool.provider,
        tool: tool.key,
        label: tool.label,
        target: line(shown.target),
        title: line(shown.title),
        text: runner.plain(shown.text),
        attachments: (Array.isArray(shown.attachments) ? shown.attachments : []).map(line).filter(Boolean),
    };
    const part = partTooLong(card);
    if (part) throw refuse(`The ${part} of this write is too long to show whole on its approval card, so it was not filed. Shorten it and ask again.`, 'card_too_long', 400);
    return card;
};

/* Asked when a proposal is filed and again when an approver edits one. */
const prepareChanges = async (companyId, ownerId, changes) => {
    const list = Array.isArray(changes) ? changes : [];
    if (!hasWrite(list)) return list;
    if (!ownerId) throw refuse(REFUSAL.NO_OWNER, 'no_person', 400);
    const out = [];
    for (const change of list) {
        if (!change || !isWrite(change.action)) { out.push(change); continue; }
        // eslint-disable-next-line no-await-in-loop
        const { tool, args, params } = await runner.admitWrite({ companyId, userId: String(ownerId), key: change.action, input: change.params });
        const card = cardOf(tool, args);
        out.push({ ...change, params, card, label: card.title || card.target });
    }
    return out;
};

const gatedByOwner = (proposal, changes = proposal && proposal.changes) => Boolean(proposal)
    && (proposal.gate === GATE || hasWrite(changes));

/* null when `userId` may approve the proposal's connector writes; otherwise why not. An owner or an admin is no exception. */
const approverRefusal = (userId, proposal, changes) => {
    if (!gatedByOwner(proposal, changes)) return null;
    return proposal.connectionOwner && String(proposal.connectionOwner) === String(userId) ? null : REFUSAL.NOT_OWNER;
};

const attemptOf = (action, params) => `${action}:${crypto.createHash('sha256').update(JSON.stringify(params || {})).digest('hex').slice(0, 32)}`;

/* Taken before anything is sent, so a crash after the provider answered can never send the same approval twice. */
const claimAttempt = async (companyId, proposalId, attempt) => {
    let id;
    try { id = new mongoose.Types.ObjectId(String(proposalId)); } catch (e) { return false; }
    const claimed = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: id, sendAttempts: { $ne: attempt } }, { $push: { sendAttempts: attempt } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    return Boolean(claimed);
};

const send = async ({ companyId, actor, action, params, proposal }) => {
    if (!proposal || !proposal.id) throw refuse(REFUSAL.NOT_FROM_PROPOSAL, 'not_approved');
    const userId = String((actor && actor.userId) || '');
    if (!proposal.connectionOwner || String(proposal.connectionOwner) !== userId) throw refuse(REFUSAL.NOT_OWNER, 'not_owner');
    const asApproved = { ...params };
    delete asApproved.__proposal;
    if (!(await claimAttempt(companyId, proposal.id, attemptOf(action, asApproved)))) throw refuse(REFUSAL.SENT_ONCE, 'sent_once', 409);
    const tool = tools.get(action);
    const out = await runner.write({ companyId, userId, key: action, params: asApproved });
    return { result: out, undo: null, entityType: 'connector_write', entityId: action, entityName: tool ? tool.definition.name : action };
};

const executorFor = (action) => (isWrite(action) ? (args) => send({ ...args, action }) : null);

const deliveryOf = (changes, applied) => (Array.isArray(changes) ? changes : [])
    .map((change, i) => ({ change, outcome: (applied || [])[i] || {} }))
    .filter(({ change }) => change && isWrite(change.action))
    .map(({ change, outcome }) => ({
        action: change.action, ok: Boolean(outcome.ok),
        connectionId: String((change.params || {}).connectionId || ''),
        ...(outcome.ok ? { answer: String((outcome.result && outcome.result.text) || '').slice(0, ERROR_MAX) } : { error: String(outcome.error || 'not sent').replace(/^[a-z_]+: /, '').slice(0, ERROR_MAX) }),
        at: new Date(),
    }));

module.exports = { GATE, REFUSAL, isWrite, hasWrite, cardOf, prepareChanges, gatedByOwner, approverRefusal, send, executorFor, deliveryOf };
