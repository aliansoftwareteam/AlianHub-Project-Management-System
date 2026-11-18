const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

async function activeMemberIds(companyId, userIds) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean).map(String))];
    if (!ids.length) return [];
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: ids }, ...ACTIVE_SEAT }, { userId: 1 }],
    }, 'find');
    const active = new Set((seats || []).map((seat) => String(seat.userId)));
    return ids.filter((id) => active.has(id));
}

module.exports = { activeMemberIds };
