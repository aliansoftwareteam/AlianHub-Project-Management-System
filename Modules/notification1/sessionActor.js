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

module.exports = { notificationAsSessionUser };
