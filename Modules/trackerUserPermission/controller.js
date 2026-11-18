const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { pinSessionTenant } = require('../../Config/tenant');
const { releaseTrackerSeat } = require('../DesktopTracker/trackerSeats');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const GRANT_MOVED = 'Tracker access now comes from the role: turn on "Desktop time tracker" for it in Security & Permissions.';

/* Access comes from the role (Security & Permissions); on a plan with tracker seats this only gives a seat back. */
exports.handleTrackerUserPermission = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const dataObj = req.body && req.body.DataObj;
        if (!dataObj || typeof dataObj !== 'object') return res.send({ status: false, message: 'DataObj is required' });
        if (!isPrivileged(await getRoleType(companyId, req.uid))) {
            return res.status(403).send({ status: false, message: 'Only an owner or admin can change tracker access' });
        }
        if (dataObj.ops !== false) return res.send({ status: false, message: GRANT_MOVED, statusText: GRANT_MOVED });

        const userId = String((dataObj.data && dataObj.data.userId) || '');
        if (!OBJECT_ID.test(userId)) return res.send({ status: false, message: 'userId is required' });
        const member = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId }, { _id: 1 }] }, 'findOne');
        if (!member) return res.send({ status: false, message: 'That member is not part of this workspace.' });

        await releaseTrackerSeat(companyId, userId);
        return res.send({ status: true, message: 'Tracker_user_removed_successfully' });
    } catch (error) {
        logger.error(`ERROR in update handleTrackerUserPermission: ${error.message}`);
        return res.send({ status: false, message: 'Something went wrong.' });
    }
};
