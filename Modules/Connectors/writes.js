const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const tools = require('./tools');
const runner = require('./toolRunner');
const quotas = require('./quotas');
const callAudit = require('./callAudit');
const connectionTools = require('./connectionTools');

/* A write to a connected app is filed as a proposal that only the connection's owner approves, and is sent once,
 * with exactly the params that owner saw on its card (FR-21 to FR-23 of task 056). */

const GATE = tools.WRITE_GATE;
const CARD_TEXT_MAX = 20000;
const CARD_LINE_MAX = 300;
const ATTACHMENTS_MAX = 20;
const ROWS_MAX = 20;
const CARD_KEY = /^Connectors\.card\.[A-Za-z0-9_]+$/;
const ERROR_MAX = 300;
const READ_ANSWER_MAX = 4000;
const FILED = 'filed';
const REFUSAL = Object.freeze({
    NOT_OWNER: 'Only the person whose connection this is can approve it. It stays waiting for them.',
    NO_OWNER: 'A write to a connected app needs the person whose connection it uses.',
    NOT_FROM_PROPOSAL: 'A write to a connected app is sent only from a proposal its owner approved.',
    SENT_ONCE: 'This approval was already used to send, so it is not sent again. Ask for a new one.',
    TOKEN_FILED: 'A write to a connected app is proposed only by an agent run or an MCP call, not through this route.',
    CARD_CHANGED: 'This write was edited after this card was shown, so nothing was sent. Reload, read the new card, and approve that one.',
    NOT_UNDOABLE: 'This was already sent to the connected app, so it cannot be undone from here. Change it in that app.',
});

const refuse = (message, code, status = 403) => Object.assign(new Error(message), { status, code, deterministic: true });

/* The runner's messages open with a code and a tool key for the model that called it; a person reads what follows. */
const spoken = (message) => String(message || '').replace(/^[a-z_]+: /, '').replace(/^[a-z0-9_]+(\.[a-z0-9_]+)+: /, '');

/* A tool an MCP app's server lists has its kind only on its owner's connection, so it is held as a write here. */
const isWrite = (action) => {
    const tool = tools.get(action);
    if (tool) return tool.kind === tools.KIND.WRITE;
    return Boolean(connectionTools.liveDefinition(connectionTools.splitKey(action).provider));
};

/* A read its owner set to Needs approval waits on their card like a write. `approval` is set only by markApprovalReads,
 * never taken from what the filer sent, so a filer cannot drop a read's card or put one on anything else. */
const isGated = (change) => Boolean(change) && (isWrite(change.action) || change.approval === true);
const hasWrite = (changes) => (Array.isArray(changes) ? changes : []).some(isGated);

const isCatalogRead = (action) => {
    const tool = tools.get(action);
    return Boolean(tool) && !tool.custom && tool.kind === tools.KIND.READ;
};

/* A connection that cannot be loaded refuses the filing: filed as an ordinary change, the read would skip its owner's card. */
const approvalRead = async (companyId, ownerId, action) => {
    if (!ownerId || !isCatalogRead(action)) return false;
    const tool = tools.get(action);
    const connection = await runner.connectionOf(tool, companyId, ownerId).catch((error) => {
        throw error && error.deterministic ? refuse(spoken(error.message), error.code, 400) : error;
    });
    return require('./toolPermissions').permissionOf(tool, connection) === connectionTools.PERMISSION.APPROVAL;
};

const markApprovalReads = async (companyId, ownerId, changes) => {
    if (!Array.isArray(changes)) return changes;
    return Promise.all(changes.map(async (change) => {
        if (!change || typeof change !== 'object') return change;
        const rest = { ...change };
        delete rest.approval;
        return (await approvalRead(companyId, ownerId, rest.action)) ? { ...rest, approval: true } : rest;
    }));
};

const line = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();

/* The params are sent whole, so a card that had to cut anything would show less than goes out: such a write is refused. */
const partTooLong = (card) => {
    if (card.target.length > CARD_LINE_MAX) return 'target';
    if (card.title.length > CARD_LINE_MAX) return 'title';
    if (card.text.length > CARD_TEXT_MAX) return 'text';
    if (card.attachments.length > ATTACHMENTS_MAX || card.attachments.some((name) => name.length > CARD_LINE_MAX)) return 'attachments';
    const rows = card.rows || [];
    if (rows.length > ROWS_MAX || rows.some((row) => String(row.value || '').length > CARD_TEXT_MAX)) return 'details';
    return '';
};

/* A label is an i18n key the Inbox translates; a value is the person's own data and is shown as it goes out. */
const rowOf = (row) => {
    if (!CARD_KEY.test(String(row && row.label)) || (row.valueLabel !== undefined && !CARD_KEY.test(String(row.valueLabel)))) {
        throw new Error(`a card row needs Connectors.card.* keys: ${JSON.stringify(row)}`);
    }
    return { label: row.label, ...(row.valueLabel === undefined ? { value: runner.plain(row.value) } : { valueLabel: row.valueLabel }) };
};

const plainCard = (tool, args) => ({ target: tool.definition.name, title: tool.key, text: JSON.stringify(args, null, 2) });

const cardOf = (tool, args) => {
    const shown = (typeof tool.card === 'function' ? tool.card(args) : plainCard(tool, args)) || {};
    const card = {
        provider: tool.provider,
        tool: tool.key,
        label: tool.label,
        target: line(shown.target),
        ...(shown.targetLabel ? { targetLabel: rowOf({ label: shown.targetLabel }).label } : {}),
        title: line(shown.title),
        ...(shown.headline ? { headline: line(shown.headline) } : {}),
        text: runner.plain(shown.text),
        attachments: (Array.isArray(shown.attachments) ? shown.attachments : []).map(line).filter(Boolean),
        ...(Array.isArray(shown.rows) && shown.rows.length ? { rows: shown.rows.map(rowOf) } : {}),
        ...(tool.editable ? { fields: tool.editable.map((field) => JSON.parse(JSON.stringify(field))) } : {}),
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
        if (!isGated(change)) { out.push(change); continue; }
        // eslint-disable-next-line no-await-in-loop
        const { tool, args, params } = await runner.admitWrite({ companyId, userId: String(ownerId), key: change.action, input: change.params });
        const card = cardOf(tool, args);
        out.push({ ...change, params, card, label: card.title || card.headline || card.target });
    }
    return out;
};

/* Filing is what the daily limit counts and what the audit shows: an edit of a waiting proposal goes through prepareChanges alone.
 * `save` stores the proposal inside the claim, so a row that was never stored gives its count back. `refusalOf(action)`
 * names why the filer may not use a tool at all (an agent without it ticked), and refuses the whole filing. */
const fileChanges = async (companyId, ownerId, changes, { via, id, runId = null, refusalOf = null }, save) => {
    const list = Array.isArray(changes) ? changes : [];
    if (!hasWrite(list)) return save(list);
    const audited = (state, reason = '', connectionOf = () => '') => list.filter(isGated).forEach((c) => callAudit.record(companyId, {
        userId: ownerId, via, callerId: id, runId, key: c.action, tool: tools.get(c.action), phase: callAudit.PHASE.PROPOSE, input: c.params, connectionId: connectionOf(c), state, reason,
    }));
    const notAllowed = typeof refusalOf === 'function' ? list.filter(isGated).map((c) => refusalOf(c.action)).find(Boolean) : '';
    if (notAllowed) {
        audited(runner.STATE.REFUSED, 'agent_not_allowed');
        throw refuse(notAllowed, 'agent_not_allowed');
    }
    let prepared;
    try {
        prepared = await prepareChanges(companyId, ownerId, list);
    } catch (error) {
        audited(runner.STATE.REFUSED, String(error.code || 'error'));
        throw error;
    }
    const connectionsByAction = new Map(prepared.filter(isGated).map((c) => [c.action, c.params.connectionId]));
    const connectionOf = (c) => connectionsByAction.get(c.action) || '';
    const claimed = [];
    try {
        for (const change of prepared.filter(isGated)) {
            const claim = change.approval === true ? quotas.claimRead : quotas.claimWriteProposal;
            // eslint-disable-next-line no-await-in-loop
            claimed.push(await claim(companyId, { connectionId: change.params.connectionId, userId: ownerId, actor: { type: via, id } }));
        }
    } catch (error) {
        await Promise.all(claimed.map((claim) => claim.release()));
        audited(runner.STATE.REFUSED, String(error.code || 'error'), connectionOf);
        throw error;
    }
    let saved;
    try {
        saved = await save(prepared);
    } catch (error) {
        await Promise.all(claimed.map((claim) => claim.release()));
        audited(runner.STATE.FAILED, String(error.code || 'error'), connectionOf);
        throw error;
    }
    audited(FILED, '', connectionOf);
    return saved;
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
    const tool = tools.get(action);
    const out = await runner.write({
        companyId, userId, key: action, params: asApproved,
        beforeSend: async () => {
            if (!(await claimAttempt(companyId, proposal.id, attemptOf(action, asApproved)))) throw refuse(REFUSAL.SENT_ONCE, 'sent_once', 409);
        },
    });
    return { result: out, undo: null, entityType: 'connector_write', entityId: action, entityName: tool ? tool.definition.name : action };
};

/* An approved read runs once, like a write, and what it read is kept on its proposal for its owner to see there. */
const isApprovedRead = (action, change) => Boolean(change && change.approval === true) && isCatalogRead(action);
const executorFor = (action, change) => (isWrite(action) || isApprovedRead(action, change) ? (args) => send({ ...args, action }) : null);

const deliveryOf = (changes, applied) => (Array.isArray(changes) ? changes : [])
    .map((change, i) => ({ change, outcome: (applied || [])[i] || {} }))
    .filter(({ change }) => isGated(change))
    .map(({ change, outcome }) => ({
        action: change.action, ok: Boolean(outcome.ok), ...(change.approval === true ? { read: true } : {}),
        connectionId: String((change.params || {}).connectionId || ''),
        ...(outcome.ok ? { answer: String((outcome.result && outcome.result.text) || '').slice(0, change.approval === true ? READ_ANSWER_MAX : ERROR_MAX) } : { error: String(outcome.error || 'not sent').replace(/^[a-z_]+: /, '').slice(0, ERROR_MAX) }),
        at: new Date(),
    }));

/* What an approved read brought back is the owner's own data from their app, so no one else is sent it: not the
 * workspace's socket, not another member's Inbox, not an agent. */
const shownTo = (proposal, viewerId = '') => {
    if (!proposal || !Array.isArray(proposal.delivery) || !proposal.delivery.some((entry) => entry && entry.read)) return proposal;
    const owner = String(proposal.connectionOwner || '');
    if (owner && viewerId && String(viewerId) === owner) return proposal;
    return { ...proposal, delivery: proposal.delivery.map((entry) => (entry && entry.read ? { ...entry, answer: undefined, hidden: Boolean(entry.answer) } : entry)) };
};

module.exports = { GATE, REFUSAL, spoken, isWrite, isGated, isApprovedRead, hasWrite, markApprovalReads, cardOf, prepareChanges, fileChanges, gatedByOwner, approverRefusal, send, executorFor, deliveryOf, shownTo };
