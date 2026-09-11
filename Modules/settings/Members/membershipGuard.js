const { getRoleType, isPrivileged, ROLE_OWNER, ROLE_ADMIN } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');

const ACTIVE = 2;
const CANCELLED = 3;
const SELF_SERVICE_FIELDS = Object.freeze(['dashboardLocked']);
const FIXED_FIELDS = Object.freeze(['_id', 'userId', 'companyId', 'userEmail', 'linkId', 'legacyId', 'demo', 'createdAt', 'updatedAt']);
const INVITATION_FIELDS = Object.freeze(['userId', 'status']);

const allowed = Object.freeze({ ok: true });
const refuse = (statusText, code = 403) => ({ ok: false, code, statusText });
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rootOf = (field) => String(field).split('.')[0];
const grantsPrivilege = (roleType) => Number(roleType) === ROLE_OWNER || Number(roleType) === ROLE_ADMIN;

const judgeMemberUpdate = ({ callerId, callerRole, target, data, activeOwners }) => {
    const fields = Object.keys(data);
    if (fields.some((field) => field.startsWith('$'))) return refuse('Member fields cannot be update operators.', 400);
    const roots = fields.map(rootOf);
    if (roots.some((field) => FIXED_FIELDS.includes(field))) return refuse('The account or company a membership belongs to cannot be changed.');

    const isSelf = String(target.userId || '') === String(callerId || '');
    if (!isPrivileged(callerRole)) {
        if (!isSelf) return refuse('Only an owner or an admin can change another member.');
        if (roots.some((field) => !SELF_SERVICE_FIELDS.includes(field))) return refuse('You can only change your own preferences here.');
        return allowed;
    }

    const nextRole = has(data, 'roleType') ? Number(data.roleType) : target.roleType;
    if (!Number.isInteger(nextRole) || nextRole < 0) return refuse('That role does not exist.', 400);
    const changesRole = nextRole !== target.roleType;
    const removes = data.isDelete === true || (has(data, 'status') && Number(data.status) === CANCELLED);
    const changesSeat = removes
        || (has(data, 'status') && Number(data.status) !== target.status)
        || (has(data, 'isDelete') && Boolean(data.isDelete) !== Boolean(target.isDelete));

    if (changesRole && isSelf) return refuse('Nobody can change their own role.');
    if ((changesRole || changesSeat) && target.roleType === ROLE_OWNER && callerRole !== ROLE_OWNER) return refuse('Only an owner can change another owner.');
    if (changesRole && grantsPrivilege(nextRole) && callerRole !== ROLE_OWNER) return refuse('Only an owner can grant the owner or admin role.');
    const holdsSeat = target.status === ACTIVE && target.isDelete !== true;
    if (target.roleType === ROLE_OWNER && holdsSeat && ((changesRole && nextRole !== ROLE_OWNER) || removes) && activeOwners <= 1) {
        return refuse('The last owner cannot be demoted or removed.');
    }
    return allowed;
};

/* Accepting an invitation links the caller's own account and activates the seat; the role is whatever the invitation stored. */
const judgeInvitationAcceptance = ({ callerId, callerEmail, invite, data }) => {
    if (Object.keys(data).some((field) => !INVITATION_FIELDS.includes(field))) return refuse('Accepting an invitation only links your account to it.');
    if (has(data, 'userId') && String(data.userId) !== String(callerId)) return refuse('An invitation can only be linked to your own account.');
    if (has(data, 'status') && Number(data.status) !== ACTIVE) return refuse('Accepting an invitation can only activate it.');
    if (invite.isDelete === true || invite.status === CANCELLED) return refuse('That invitation is no longer valid.');
    const linkedToCaller = Boolean(invite.userId) && String(invite.userId) === String(callerId);
    const sentToCaller = Boolean(callerEmail) && String(invite.userEmail || '').toLowerCase() === String(callerEmail).toLowerCase();
    if (!linkedToCaller && !sentToCaller) return refuse('That invitation was sent to someone else.');
    return allowed;
};

const grantRefusal = (callerRole, roles) => {
    if (!isPrivileged(callerRole)) return 'Only an owner or an admin can invite members.';
    if (roles.some(grantsPrivilege) && callerRole !== ROLE_OWNER) return 'Only an owner can invite an owner or an admin.';
    return '';
};

const forbid = (res, statusText) => res.status(403).json({ status: false, statusText, message: 'Forbidden' });

const guardGrants = (rowsOf) => async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const invitations = rowsOf(req.body || {});
        if (invitations.some((row) => row && row.companyId !== undefined && String(row.companyId) !== companyId)) {
            return forbid(res, 'Invitations can only be sent into your current company.');
        }
        const refusal = grantRefusal(await getRoleType(companyId, req.uid), invitations.map((row) => row && row.role));
        return refusal ? forbid(res, refusal) : next();
    } catch (error) {
        logger.error(`membership guard: ${error.message || error}`);
        return forbid(res, 'Permission check failed.');
    }
};

const guardInvitation = guardGrants((body) => [body]);
const guardUserImport = guardGrants((body) => (Array.isArray(body.users) ? body.users : []));

module.exports = {
    SELF_SERVICE_FIELDS,
    judgeMemberUpdate,
    judgeInvitationAcceptance,
    guardInvitation,
    guardUserImport,
};
