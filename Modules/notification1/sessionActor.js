const { pinSessionTenant } = require('../../Config/tenant');
const { activeMemberIds } = require('../notification/activeMembers');

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function notificationAsSessionUser(req, res, next) {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return;
    try {
        const body = req.body;
        if (isPlainObject(body) && isPlainObject(body.userData)) {
            const ownerId = body.userData.companyOwnerId ? String(body.userData.companyOwnerId) : '';
            const [activeOwner] = ownerId ? await activeMemberIds(companyId, [ownerId]) : [];
            body.userData = { ...body.userData, id: String(req.uid), companyOwnerId: activeOwner || '' };
        }
        next();
    } catch (error) {
        next(error);
    }
}

// The history handler spreads Object.values(body) into HandleHistory's positional parameters,
// so the body is rebuilt with every field in that order, whatever order the caller sent.
function historyAsSessionUser(req, res, next) {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return;
    const body = isPlainObject(req.body) ? req.body : {};
    req.body = {
        type: body.type,
        companyId,
        projectId: body.projectId,
        taskId: body.taskId === undefined ? null : body.taskId,
        object: isPlainObject(body.object) ? body.object : {},
        userData: { ...(isPlainObject(body.userData) ? body.userData : {}), id: String(req.uid) },
    };
    next();
}

module.exports = { notificationAsSessionUser, historyAsSessionUser };
