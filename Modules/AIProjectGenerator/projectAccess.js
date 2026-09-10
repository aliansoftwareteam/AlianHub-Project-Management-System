const scope = require('../Agents/scope');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/* An optional projectId from a request body, checked against the projects the
 * caller may open. `{ projectId: null }` when none was sent, `{ hidden: true }`
 * when one was sent that the caller cannot see. */
const resolveProjectId = async ({ companyId, uid, projectId }) => {
    const id = String(projectId || '');
    if (!id) return { projectId: null };
    if (!OBJECT_ID.test(id)) return { hidden: true };
    const visible = await scope.visibleProjectIds(companyId, String(uid));
    return visible.map(String).includes(id) ? { projectId: id } : { hidden: true };
};

module.exports = { resolveProjectId };
