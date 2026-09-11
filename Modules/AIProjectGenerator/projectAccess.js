const scope = require('../Agents/scope');
const { evaluatePermission, isWritable } = require('../../Config/permissionGuard');

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

/* A project the caller may write into: visible to them, and every catalogue key
 * in `permissions` writable for that project. `{ hidden: true }` answers 404,
 * `{ forbidden: key }` answers 403. */
const canEditProject = async ({ companyId, uid, projectId, permissions = [] }) => {
    const resolved = await resolveProjectId({ companyId, uid, projectId });
    if (!resolved.projectId) return { hidden: true };
    for (const key of permissions) {
        let value = null;
        try {
            value = await evaluatePermission(companyId, String(uid), key, { projectId: resolved.projectId });
        } catch (_e) {
            value = null;
        }
        if (!isWritable(value)) return { forbidden: key };
    }
    return { projectId: resolved.projectId };
};

module.exports = { resolveProjectId, canEditProject };
