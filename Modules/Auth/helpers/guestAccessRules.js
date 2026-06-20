// SEC-01 guest/client role access rules. Pure — no I/O — shared by the
// permission guards and tests.
//
// A guest (roleType 4) is an external client/viewer who may only see the
// projects explicitly assigned to them (company_users.guestProjectIds).

const ROLE_GUEST = 4;

const isGuest = (roleType) => Number(roleType) === ROLE_GUEST;

/* Is `projectId` within a guest's assigned project ids? Compares as strings so
 * ObjectId / string ids match. Empty/missing projectId is never allowed. */
const guestAllowsProject = ({ guestProjectIds = [], projectId } = {}) => {
    if (projectId === null || projectId === undefined || projectId === '') return false;
    return (guestProjectIds || []).map((id) => String(id)).includes(String(projectId));
};

module.exports = { ROLE_GUEST, isGuest, guestAllowsProject };
