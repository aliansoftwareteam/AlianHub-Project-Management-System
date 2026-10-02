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
const WHY = Object.freeze({ SEAT: 'seat', OWNER_ADMIN: 'owner_admin', OWN_RIGHTS: 'own_rights', FIRST_APPROVER: 'first_approver' });
const KEEPS_WAITING = 'It stays waiting for someone who can.';
const REFUSAL = Object.freeze({
    OWNER_ADMIN: 'This proposal needs an Owner or Admin.',
    NO_RIGHT: `You cannot approve this: you do not hold the right to make this change yourself. ${KEEPS_WAITING}`,
    CANNOT_OPEN: `You cannot approve this: you cannot open what this change touches. ${KEEPS_WAITING}`,
    NOT_THEIRS: `You cannot approve this: it was asked for someone else, and only they can. ${KEEPS_WAITING}`,
    DECLINE: 'You can decline a proposal you could approve, or one your own agent asked for.',
    FIRST_APPROVER: 'You cannot approve this: only the person who approved the plan can try these parts again. It stays waiting for them.',
});

const held = (error, why) => ({ error, status: 403, reason: NOT_PERMITTED, why });

const needsOwnerOrAdmin = (proposal, changes) => proposal.gate === access.GATE_OWNER_ADMIN
    || changes.some((change) => { const entry = registry.get(change && change.action); return Boolean(entry) && entry.gate === access.GATE_OWNER_ADMIN; });

/* Why the approver may not approve one change, in the words the approve route answers, or ''. A connected agent's
 * change runs as the person behind the connection, so the approver is asked what Mcp/approval asks of them, by the
 * same function; any other runs on the approver's own rights, so they are asked what perform() will ask. */
const changeRefusal = async (companyId, userId, proposal, change) => {
    if (proposal.source === SOURCE_MCP) {
        const approval = require('../Mcp/approval');
        const stopped = await approval.approverRefusal(companyId, userId, proposal, change || {});
        if (!stopped) return '';
        if (stopped.lacks === approval.LACKS.STANDING) return REFUSAL.NOT_THEIRS;
        return stopped.lacks === approval.LACKS.RIGHT ? REFUSAL.NO_RIGHT : REFUSAL.CANNOT_OPEN;
    }
    const reason = await require('./actions').personRefusal(companyId, { kind: 'human', userId: String(userId) }, change.action, (change && change.params) || {});
    if (!reason) return '';
    return reason.startsWith(permissions.REASON) ? REFUSAL.NO_RIGHT : REFUSAL.CANNOT_OPEN;
};

/* null when the person may approve `changes` of the proposal; otherwise the refusal the approve route answers. */
const approveRefusal = async (companyId, { userId, privileged }, proposal, changes = proposal.changes) => {
    const list = Array.isArray(changes) ? changes : [];
    if (needsOwnerOrAdmin(proposal, list) && !privileged) return held(REFUSAL.OWNER_ADMIN, WHY.OWNER_ADMIN);
    for (const change of list) {
        // eslint-disable-next-line no-await-in-loop
        const lacking = await changeRefusal(companyId, userId, proposal, change);
        if (lacking) return held(lacking, WHY.OWN_RIGHTS);
    }
    return null;
};

const OPEN = Object.freeze({ locked: false, lockedWhy: '', mayDecline: true });
/* A row whose standing could not be read is shown as not the reader's to decide; the routes still answer for it. */
const UNREAD = Object.freeze({ locked: true, lockedWhy: WHY.OWN_RIGHTS, mayDecline: false });

/* Whether a change of the proposal is one only the person it was asked for approves, which no role answers for. */
const asksWhoeverApproves = (proposal) => proposal.source === SOURCE_MCP
    && (Array.isArray(proposal.changes) ? proposal.changes : []).some((change) => require('../Mcp/approval').approvedByRequesterAlone(change));

/* A plan can hold a part it cannot make for anyone (./planLocks.js), which is read for an owner or an admin too. */
const holdsPlan = (proposal) => (Array.isArray(proposal.changes) ? proposal.changes : []).some((change) => change && require('./planChoice').isPlan(change.action));

/* null unless the proposal holds parts of a plan that were not made the first time (./planFollowUp.js): those are
 * tried once more by the person who approved the plan, and by nobody else. */
const retryRefusal = (userId, proposal) => (proposal.retryBy && String(proposal.retryBy) !== String(userId) ? held(REFUSAL.FIRST_APPROVER, WHY.FIRST_APPROVER) : null);

/* What a list shows of a waiting proposal for the person reading it. An owner or an admin holds every right, so
 * their rights are not read: what can still stop their approval is a task or a list that is gone, which the approve
 * route answers, a change asked for someone else, and a plan that can make nothing for anyone, which are read here.
 * They may decline either way. A plan is a person's to approve while it holds a part they may approve (./planLocks.js). */
const standingOf = async (companyId, caller, proposal, seen = null) => {
    if (!access.decidesProposals(caller)) return { locked: true, lockedWhy: WHY.SEAT, mayDecline: false };
    const privileged = Boolean(caller.privileged);
    const uid = String(caller.actor.userId);
    const notTheirs = retryRefusal(uid, proposal);
    const person = { userId: uid, privileged };
    const holdsEveryRight = privileged && !asksWhoeverApproves(proposal);
    if (holdsEveryRight && !notTheirs && !holdsPlan(proposal)) return OPEN;
    const open = notTheirs ? {} : await require('./planLocks').withoutLocked(companyId, person, proposal.changes, proposal, seen);
    const refusal = notTheirs || open.refusal || (holdsEveryRight ? null : await approveRefusal(companyId, person, proposal, open.changes));
    if (!refusal) return OPEN;
    return { locked: true, lockedWhy: refusal.why, mayDecline: privileged || await access.isOwnProposal(companyId, uid, proposal) };
};

const READ_AT_ONCE = 20;

/* The standing of each proposal of a list, a few at a time. `seen` is the request's memory of the rights it has read (./planLocks.js). */
const standingsOf = async (companyId, caller, proposals, seen = null) => {
    const standings = [];
    for (let at = 0; at < proposals.length; at += READ_AT_ONCE) {
        // eslint-disable-next-line no-await-in-loop
        standings.push(...await Promise.all(proposals.slice(at, at + READ_AT_ONCE).map((proposal) => standingOf(companyId, caller, proposal, seen).catch((error) => {
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

module.exports = { WHY, REFUSAL, OPEN, approveRefusal, retryRefusal, standingOf, standingsOf, declineRefusal };
