const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { SEAT_ACTIVE, ACTIVE_SEAT } = require('../Config/seatStatus');
const { MongoDbCrudOpration } = require('./mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// An accepted seat, current or since removed: a former member's name stays on the work they
// left behind, while an invitation nobody accepted makes no one a member.
const ACCEPTED_SEAT = Object.freeze({ status: SEAT_ACTIVE });

async function seatedIds(companyId, userIds, seat) {
    const ids = [...new Set((userIds || []).map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!ids.length || !OBJECT_ID.test(String(companyId || ''))) return [];
    const seats = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: ids }, ...seat }, { userId: 1 }],
    }, 'find');
    const seated = new Set((seats || []).map((row) => String(row.userId)));
    return ids.filter((id) => seated.has(id));
}

const acceptedMemberIds = (companyId, userIds) => seatedIds(companyId, userIds, ACCEPTED_SEAT);
const activeMemberIds = (companyId, userIds) => seatedIds(companyId, userIds, ACTIVE_SEAT);

async function memberProfiles(companyId, userIds, projection) {
    const ids = await acceptedMemberIds(companyId, userIds);
    if (!ids.length) return [];
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, projection],
    }, 'find');
    return users || [];
}

module.exports = { ACCEPTED_SEAT, acceptedMemberIds, activeMemberIds, memberProfiles };
