const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const activeSeatUserIds = async (companyId, userIds) => {
    const filter = { ...ACTIVE_SEAT };
    if (userIds) filter.userId = { $in: [...new Set(userIds.map(String))] };
    const seats = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [filter, { userId: 1 }],
    }, 'find');
    return [...new Set((seats || []).map((seat) => String(seat.userId)).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
};

/* Users with a live seat in this company that also match `match`; people seated only elsewhere
 * are indistinguishable from people who do not exist. */
const findCompanyMembers = async (companyId, match, projection) => {
    if (!companyId) return [];
    const memberIds = await activeSeatUserIds(companyId);
    if (!memberIds.length) return [];
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ ...match, _id: { $in: memberIds.map((id) => new mongoose.Types.ObjectId(id)) } }, projection],
    }, 'find');
    return users || [];
};

const activeMemberIdSet = async (companyId, userIds) => {
    const wanted = (userIds || []).filter(Boolean).map(String);
    if (!companyId || !wanted.length) return new Set();
    return new Set(await activeSeatUserIds(companyId, wanted));
};

module.exports = { findCompanyMembers, activeMemberIdSet };
