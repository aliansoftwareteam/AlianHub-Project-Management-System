// Reading a workflow approval the way the person who has to answer it needs it:
// who owns it now, how long they have, who it goes to next and where it has
// already been.
//
// Pure, like workflowRun.js, so the rules are testable without a component. The
// shapes are the rows Modules/Workflows/controller.js builds from
// `workflow_approvals`.

export const APPROVAL_STATUSES = Object.freeze(["pending", "approved", "rejected", "expired"]);

export const DECISIONS = Object.freeze(["approved", "rejected"]);

export const approvalStatusOf = (approval) => (APPROVAL_STATUSES.includes(String(approval?.status)) ? String(approval.status) : "pending");

export const isOpen = (approval) => approvalStatusOf(approval) === "pending";

export const canDecide = (approval) => isOpen(approval) && approval?.canDecide === true;

const at = (value) => {
    const ms = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

/* Soon is an hour: near enough that a person should answer now, far enough that
 * a day-long approval is not shouting from the moment it opens. */
export const SOON_MS = 60 * 60 * 1000;

export const deadlineOf = (approval, now = Date.now()) => {
    const ms = at(approval?.deadlineAt);
    if (ms === null) return null;
    return { at: new Date(ms), ms: ms - now, overdue: ms <= now, soon: ms > now && ms - now <= SOON_MS };
};

/* The escalation path, whether it is still ahead or already taken. A request
 * with neither a second person nor a time to hand it over has none. */
export const escalationOf = (approval, now = Date.now()) => {
    const escalatedAt = at(approval?.escalatedAt);
    const due = at(approval?.escalateAt);
    if (!approval?.escalateToUserId && due === null && escalatedAt === null) return null;
    return {
        userId: approval?.escalateToUserId || null,
        name: approval?.escalateToName || null,
        at: due === null ? null : new Date(due),
        escalated: escalatedAt !== null,
        escalatedAt: escalatedAt === null ? null : new Date(escalatedAt),
        due: escalatedAt === null && due !== null && due <= now
    };
};

export const ownerOf = (approval) => ({
    userId: approval?.ownerUserId || null,
    name: approval?.ownerName || null,
    role: approval?.ownerRole || null
});

/* Where the request has been: one entry per handover, oldest first, each saying
 * who moved it and to whom. */
export const handoversOf = (approval) => (Array.isArray(approval?.reassignments) ? approval.reassignments : []).map((move) => ({
    from: move?.from || null,
    fromName: move?.fromName || null,
    to: move?.to || null,
    toName: move?.toName || null,
    by: move?.by || null,
    byName: move?.byName || null,
    at: move?.at ? new Date(move.at) : null,
    reason: String(move?.reason || "")
}));

/* The order an inbox wants: what is overdue first, then what is due soonest,
 * then the ones with no deadline at all, oldest first. */
export const sortApprovals = (rows = [], now = Date.now()) => [...rows].sort((a, b) => {
    const left = deadlineOf(a, now);
    const right = deadlineOf(b, now);
    if (left && right) return left.ms - right.ms;
    if (left) return -1;
    if (right) return 1;
    return (at(a?.createdAt) || 0) - (at(b?.createdAt) || 0);
});
