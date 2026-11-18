const CREATED_KEY = "ah.quickCreate.created";
const CARRY_MS = 30 * 60 * 1000;
const PLACE_TYPES = new Set(["project", "sprint"]);

const storageOf = () => {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
};

const createdKey = (companyId, userId) => `${CREATED_KEY}.${companyId || ""}.${userId || ""}`;

export function rememberCreated(companyId, userId, { projectId, sprintId = "", assigneeId = "", due = "" } = {}, storage = storageOf(), now = Date.now()) {
    try {
        if (!storage || !projectId) return;
        storage.setItem(createdKey(companyId, userId), JSON.stringify({
            projectId: String(projectId), sprintId: String(sprintId || ""), assigneeId: String(assigneeId || ""), due: String(due || ""), at: now
        }));
    } catch {
        /* storage may be unavailable */
    }
}

export function readCreated(companyId, userId, storage = storageOf()) {
    try {
        const raw = storage && storage.getItem(createdKey(companyId, userId));
        const value = raw ? JSON.parse(raw) : null;
        return value && value.projectId ? value : null;
    } catch {
        return null;
    }
}

/* The newest project or list the person had open, from `/api/v2/recent-visits?types=project,sprint`. */
export function placeOfVisits(visits) {
    const hit = (visits || []).find((v) => v && PLACE_TYPES.has(v.type) && v.route && v.route.projectId);
    return hit ? { projectId: String(hit.route.projectId), sprintId: String(hit.route.sprintId || "") } : null;
}

/* A list is never taken from another project than the one chosen. */
export function preferredSprint({ requestedId = "", routeSprintId = "", projectId = "", visit = null, created = null } = {}) {
    if (requestedId) return String(requestedId);
    if (routeSprintId) return String(routeSprintId);
    const pid = String(projectId);
    if (visit && String(visit.projectId) === pid && visit.sprintId) return visit.sprintId;
    if (created && String(created.projectId) === pid && created.sprintId) return created.sprintId;
    return "";
}

/* Who the last task in this project went to, while they can still be picked; else the person; else nobody. */
export function inferAssignee({ created = null, projectId = "", memberIds = [], me = "" } = {}) {
    if (created && String(created.projectId) === String(projectId)) {
        if (!created.assigneeId) return "";
        if (memberIds.includes(created.assigneeId)) return created.assigneeId;
    }
    return memberIds.includes(me) ? me : "";
}

/* A due day carries over only inside a run of tasks made one after another, and never into the past. */
export function inferDue({ created = null, projectId = "", today = "", now = Date.now() } = {}) {
    if (!created || !created.due || String(created.projectId) !== String(projectId)) return "";
    if (now - Number(created.at || 0) > CARRY_MS) return "";
    return today && created.due < today ? "" : created.due;
}
