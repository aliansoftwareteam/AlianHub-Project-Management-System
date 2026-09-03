/**
 * Reporting lines between company members. Pure: no db, no cache, no express.
 *
 * A member is identified by its `userId` — that is what every other cross-reference
 * in the app (task assignees, team membership) already uses. `managerId` holds the
 * userId of another member of the same company, or "" for "no manager recorded",
 * which is a normal state and never an error.
 */

const ACTIVE_STATUS = 2;
const GUEST_ROLE = 0;

const REASON = Object.freeze({
    NO_SUBJECT: 'no_subject',
    NOT_A_PERSON: 'not_a_person',
    SELF: 'self',
    UNKNOWN: 'unknown',
    GUEST: 'guest',
    NOT_ACTIVE: 'not_active',
    CYCLE: 'cycle'
});

const memberId = (member) => String((member && (member.userId || member.id || member._id)) || '');

const normalizeManagerId = (value) => {
    if (value === null || value === undefined) return '';
    const id = String(value).trim();
    return id === '' || id === 'null' || id === 'undefined' ? '' : id;
};

/* Only people report to people. Anything minted for an agent or an API token is an
 * actor, not a member of the org, whichever collection it happens to turn up in. */
const isPerson = (member) => Boolean(member) && !(
    member.isAgent === true
    || member.isBot === true
    || member.ghostUser === true
    || member.kind === 'agent'
    || Boolean(member.agentId)
    || Boolean(member.apiTokenId)
);

const isActiveMember = (member) => Boolean(member)
    && Number(member.status) === ACTIVE_STATUS
    && member.isDelete !== true;

const canManage = (member) => isPerson(member)
    && isActiveMember(member)
    && Number(member.roleType) !== GUEST_ROLE;

function indexMembers(members) {
    const byId = new Map();
    (Array.isArray(members) ? members : []).forEach((member) => {
        const id = memberId(member);
        if (id && !byId.has(id)) byId.set(id, member);
    });
    return byId;
}

/* Ids above `id`, nearest first. Stops on a repeat so an already-corrupt chain
 * cannot spin here. */
function ancestorsOf(byId, id) {
    const start = String(id || '');
    const chain = [];
    const seen = new Set([start]);
    const from = byId.get(start);
    let cursor = from ? normalizeManagerId(from.managerId) : '';
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        chain.push(cursor);
        const next = byId.get(cursor);
        cursor = next ? normalizeManagerId(next.managerId) : '';
    }
    return chain;
}

/**
 * Can `subjectId` report to `managerIdValue`, given the current membership list?
 * Returns { ok: true, managerId } or { ok: false, reason }.
 */
function validateManagerAssignment(members, subjectId, managerIdValue) {
    const byId = indexMembers(members);
    const subject = String(subjectId || '').trim();
    const manager = normalizeManagerId(managerIdValue);

    if (!subject || !byId.has(subject)) return { ok: false, reason: REASON.NO_SUBJECT };
    if (!isPerson(byId.get(subject))) return { ok: false, reason: REASON.NOT_A_PERSON };
    if (!manager) return { ok: true, managerId: '' };
    if (manager === subject) return { ok: false, reason: REASON.SELF };
    if (!byId.has(manager)) return { ok: false, reason: REASON.UNKNOWN };

    const candidate = byId.get(manager);
    if (!isPerson(candidate)) return { ok: false, reason: REASON.NOT_A_PERSON };
    if (Number(candidate.roleType) === GUEST_ROLE) return { ok: false, reason: REASON.GUEST };
    if (!isActiveMember(candidate)) return { ok: false, reason: REASON.NOT_ACTIVE };
    if (ancestorsOf(byId, manager).includes(subject)) return { ok: false, reason: REASON.CYCLE };

    return { ok: true, managerId: manager };
}

/**
 * What has to change so nobody is left pointing at a member who is leaving.
 * A report inherits the departing member's own manager when that person can still
 * manage, and otherwise loses the line entirely rather than keeping a dead pointer.
 * Returns [{ userId, docId, managerId }] against the pre-write membership list.
 */
function reassignReports(members, departingId) {
    const byId = indexMembers(members);
    const departing = String(departingId || '').trim();
    if (!departing || !byId.has(departing)) return [];

    const inherited = normalizeManagerId(byId.get(departing).managerId);
    return (Array.isArray(members) ? members : [])
        .filter((member) => {
            const id = memberId(member);
            return id && id !== departing && normalizeManagerId(member.managerId) === departing;
        })
        .map((member) => {
            const id = memberId(member);
            const keep = inherited && inherited !== id && canManage(byId.get(inherited));
            return { userId: id, docId: String(member._id || ''), managerId: keep ? inherited : '' };
        });
}

/**
 * The forest. Only people who can hold a line at all are in it; a manager who has
 * left, become a guest or never existed reads as absent, so their reports surface
 * as roots instead of vanishing. Members caught in a cycle are cut loose as roots
 * and returned in `cycleIds` — the walk is iterative and visits each member once.
 */
function buildOrgTree(members) {
    const people = (Array.isArray(members) ? members : []).filter((member) => canManage(member) && memberId(member));
    const byId = indexMembers(people);
    const nodes = new Map();
    people.forEach((member) => nodes.set(memberId(member), { id: memberId(member), member, reports: [] }));

    const childrenOf = new Map();
    const rootIds = [];
    people.forEach((member) => {
        const id = memberId(member);
        const manager = normalizeManagerId(member.managerId);
        if (manager && manager !== id && byId.has(manager)) {
            if (!childrenOf.has(manager)) childrenOf.set(manager, []);
            childrenOf.get(manager).push(id);
        } else {
            rootIds.push(id);
        }
    });

    const visited = new Set();
    const expand = (seed) => {
        const stack = [seed];
        while (stack.length) {
            const id = stack.pop();
            const parent = nodes.get(id);
            (childrenOf.get(id) || []).forEach((child) => {
                if (visited.has(child)) return;
                visited.add(child);
                parent.reports.push(nodes.get(child));
                stack.push(child);
            });
        }
    };

    rootIds.forEach((id) => { visited.add(id); });
    rootIds.forEach(expand);

    const cycleIds = [];
    people.forEach((member) => {
        const id = memberId(member);
        if (visited.has(id)) return;
        visited.add(id);
        rootIds.push(id);
        cycleIds.push(id);
        expand(id);
    });

    const managed = people.filter((member) => {
        const manager = normalizeManagerId(member.managerId);
        return manager && byId.has(manager);
    }).length;

    return { roots: rootIds.map((id) => nodes.get(id)), cycleIds, managed };
}

module.exports = {
    ACTIVE_STATUS,
    GUEST_ROLE,
    REASON,
    memberId,
    normalizeManagerId,
    isPerson,
    isActiveMember,
    canManage,
    ancestorsOf,
    validateManagerAssignment,
    reassignReports,
    buildOrgTree
};
