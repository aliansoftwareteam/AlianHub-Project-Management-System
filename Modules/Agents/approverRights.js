const access = require('./access');
const registry = require('./registry');
const permissions = require('./permissions');
const logger = require('../../Config/loggerConfig');

// A proposal is approved by a person who could make each of its changes by hand, so an approval is applied or
// refused and never recorded with nothing done. It is declined by a person who could approve it, by an owner or
// an admin, or by the person it was filed for. The decision routes, the lists and their counts read the rule
// here, so a row is offered as open exactly when its approval would be taken.

const SOURCE_MCP = 'mcp';
const NOT_PERMITTED = 'not_permitted';
const WHY = Object.freeze({ SEAT: 'seat', OWNER_ADMIN: 'owner_admin', OWN_RIGHTS: 'own_rights' });
const KEEPS_WAITING = 'It stays waiting for someone who can.';
const REFUSAL = Object.freeze({
    OWNER_ADMIN: 'This proposal needs an Owner or Admin.',
    NO_RIGHT: `You cannot approve this: you do not hold the right to make this change yourself. ${KEEPS_WAITING}`,
    CANNOT_OPEN: `You cannot approve this: you cannot open what this change touches. ${KEEPS_WAITING}`,
    DECLINE: 'You can decline a proposal you could approve, or one your own agent asked for.',
});

const held = (error, why) => ({ error, status: 403, reason: NOT_PERMITTED, why });

const needsOwnerOrAdmin = (proposal, changes) => proposal.gate === access.GATE_OWNER_ADMIN
    || changes.some((change) => { const entry = registry.get(change && change.action); return Boolean(entry) && entry.gate === access.GATE_OWNER_ADMIN; });

/* A connected agent's change runs as the person behind the connection, so the approver is asked what Mcp/approval
 * asks of them; any other runs on the approver's own rights, so they are asked what perform() will ask. */
const changeRefusal = async (companyId, userId, proposal, change) => {
    const person = { kind: 'human', userId: String(userId) };
    const params = (change && change.params) || {};
    if (proposal.source !== SOURCE_MCP) return require('./actions').personRefusal(companyId, person, change.action, params);
    const own = await permissions.holderMay(companyId, person, change.action, params);
    if (!own.allowed) return own.reason;
    const approval = require('../Mcp/approval');
    return (await approval.reachable(companyId, { userId: person.userId, projectIds: [] }, approval.targetOf(params, change.action))) ? '' : 'not_visible';
};

/* null when the person may approve `changes` of the proposal; otherwise the refusal the approve route answers. */
const approveRefusal = async (companyId, { userId, privileged }, proposal, changes = proposal.changes) => {
    const list = Array.isArray(changes) ? changes : [];
    if (needsOwnerOrAdmin(proposal, list) && !privileged) return held(REFUSAL.OWNER_ADMIN, WHY.OWNER_ADMIN);
    for (const change of list) {
        // eslint-disable-next-line no-await-in-loop
        const lacking = await changeRefusal(companyId, userId, proposal, change);
        if (lacking) return held(lacking.startsWith(permissions.REASON) ? REFUSAL.NO_RIGHT : REFUSAL.CANNOT_OPEN, WHY.OWN_RIGHTS);
    }
    return null;
};

const OPEN = Object.freeze({ locked: false, lockedWhy: '', mayDecline: true });
/* A row whose standing could not be read is shown as not the reader's to decide; the routes still answer for it. */
const UNREAD = Object.freeze({ locked: true, lockedWhy: WHY.OWN_RIGHTS, mayDecline: false });

/* What a list shows of a waiting proposal for the person reading it. An owner or an admin holds every right, so
 * nothing is read for them: what can still stop their approval is a task or a list that is gone, which the approve
 * route answers. */
const standingOf = async (companyId, caller, proposal) => {
    if (!access.decidesProposals(caller)) return { locked: true, lockedWhy: WHY.SEAT, mayDecline: false };
    if (caller.privileged) return OPEN;
    const uid = String(caller.actor.userId);
    const refusal = await approveRefusal(companyId, { userId: uid, privileged: false }, proposal);
    if (!refusal) return OPEN;
    return { locked: true, lockedWhy: refusal.why, mayDecline: await access.isOwnProposal(companyId, uid, proposal) };
};

const READ_AT_ONCE = 20;

/* The standing of each proposal of a list, a few at a time. */
const standingsOf = async (companyId, caller, proposals) => {
    const standings = [];
    for (let at = 0; at < proposals.length; at += READ_AT_ONCE) {
        // eslint-disable-next-line no-await-in-loop
        standings.push(...await Promise.all(proposals.slice(at, at + READ_AT_ONCE).map((proposal) => standingOf(companyId, caller, proposal).catch((error) => {
            logger.error(`[agent-proposal] standing of ${proposal._id}: ${error.message}`);
            return UNREAD;
        }))));
    }
    return standings;
};

/* null when the person may decline the proposal; otherwise the refusal the decline route answers. */
const declineRefusal = async (companyId, caller, proposal) => ((await standingOf(companyId, caller, proposal)).mayDecline
    ? null
    : { error: REFUSAL.DECLINE, status: 403, reason: NOT_PERMITTED });

module.exports = { WHY, REFUSAL, OPEN, approveRefusal, standingOf, standingsOf, declineRefusal };
