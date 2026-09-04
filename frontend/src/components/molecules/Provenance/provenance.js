// Provenance of Done (29a/29b) on the client. The same four rules the server
// applies in Modules/Tasks/helpers/completion.js, so a row and a rollup can
// never disagree about a task.

export const BADGES = Object.freeze({ HUMAN: "HUMAN", AGENT: "AGENT", MIXED: "MIXED", UNCHECKED: "UNCHECKED" });
export const PATTERNS = Object.freeze([BADGES.HUMAN, BADGES.AGENT, BADGES.MIXED, BADGES.UNCHECKED]);

const DONE_TYPE = "close";
const ACTOR_AGENT = "agent";

export const normalize = (completion) => {
    const c = completion && typeof completion === "object" ? completion : {};
    return {
        workBy: Array.isArray(c.workBy) ? c.workBy : [],
        checkedBy: c.checkedBy || null,
        closedBy: c.closedBy || null,
        reopenCount: Number(c.reopenCount) || 0
    };
};

export const deriveBadge = (completion) => {
    const c = normalize(completion);
    const hasAgent = c.workBy.some((w) => w.actorType === ACTOR_AGENT);
    const hasHuman = c.workBy.some((w) => w.actorType !== ACTOR_AGENT);
    if (hasAgent && !c.checkedBy) return BADGES.UNCHECKED;
    if (hasAgent && hasHuman) return BADGES.MIXED;
    if (hasAgent) return BADGES.AGENT;
    return BADGES.HUMAN;
};

export const isDone = (task) => String((task && task.statusType) || "") === DONE_TYPE;

/* An open task has no pattern yet — the badge is a statement about finished
 * work, so it is null until the task is closed. */
export const badgeOf = (task) => (isDone(task) ? deriveBadge(task && task.completion) : null);

export const isAgentWork = (task) => {
    const badge = badgeOf(task);
    return badge === BADGES.AGENT || badge === BADGES.MIXED || badge === BADGES.UNCHECKED;
};

export const CHIP_CLASS = Object.freeze({
    HUMAN: "",
    AGENT: "ah-chip--dark",
    MIXED: "ah-chip--brand",
    UNCHECKED: "ah-chip--danger"
});

export const badgeKey = (badge) => `Provenance.badge_${String(badge || "").toLowerCase()}`;
