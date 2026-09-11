const mongoose = require('mongoose');
const { getRoleType, isPrivileged, evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const CASCADE_OPERATION = 'updateMany';
const ALLOWED_OPERATIONS = Object.freeze([CASCADE_OPERATION]);

/* A project close, archive, delete or restore moves its tasks between these keys (frontend useProjectLifecycle);
   each transition needs the permission the project menu checks before offering that action. */
const CASCADE_PERMISSIONS = Object.freeze({
    '0>8': 'project.project_close',
    '0>7': 'project.project_delete',
    '0>1': 'project.project_delete',
    '7>0': 'project.project_list',
    '8>0': 'project.project_list',
});

class WriteRefused extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'WriteRefused';
        this.statusCode = statusCode;
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => isPlainObject(value) && Object.keys(value).every((k) => keys.includes(k));

const parseCascade = ({ key, firstParameter, secondParameter }) => {
    if (!ALLOWED_OPERATIONS.includes(key)) throw new WriteRefused(403, `Operation "${key}" is not allowed on tasks.`);
    if (!onlyKeys(firstParameter, ['objId', 'ProjectID', 'deletedStatusKey'])) {
        throw new WriteRefused(403, 'The filter may only name ProjectID and deletedStatusKey.');
    }
    const objId = firstParameter.objId === undefined ? {} : firstParameter.objId;
    if (!onlyKeys(objId, ['ProjectID'])) throw new WriteRefused(403, 'The filter may only name ProjectID and deletedStatusKey.');
    const projectId = String(objId.ProjectID || firstParameter.ProjectID || '');
    if (!OBJECT_ID.test(projectId)) throw new WriteRefused(403, 'The filter must name one valid ProjectID.');
    if (!onlyKeys(secondParameter, ['$set']) || !onlyKeys(secondParameter.$set, ['deletedStatusKey'])) {
        throw new WriteRefused(403, 'The update may only $set deletedStatusKey.');
    }
    const from = firstParameter.deletedStatusKey;
    const to = secondParameter.$set.deletedStatusKey;
    const permissionKey = CASCADE_PERMISSIONS[`${from}>${to}`];
    if (!Number.isInteger(from) || !Number.isInteger(to) || !permissionKey) {
        throw new WriteRefused(403, `Moving tasks from deletedStatusKey ${from} to ${to} is not allowed.`);
    }
    return { projectId, from, to, permissionKey };
};

const assertCanCascade = async (companyId, uid, { projectId, permissionKey }) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) throw new WriteRefused(403, 'You are not a member of this company.');
    if (!isPrivileged(roleType)) {
        const visible = await visibleProjectIds(companyId, uid);
        if (!visible.includes(projectId)) throw new WriteRefused(403, 'You do not have access to this project.');
    }
    const permission = await evaluatePermission(companyId, uid, permissionKey, { projectId });
    if (!isWritable(permission)) throw new WriteRefused(403, 'You do not have permission to perform this action.');
};

const cascadeFilter = ({ projectId, from }) => ({ ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: from });

module.exports = {
    ALLOWED_OPERATIONS,
    CASCADE_PERMISSIONS,
    WriteRefused,
    parseCascade,
    assertCanCascade,
    cascadeFilter,
};
