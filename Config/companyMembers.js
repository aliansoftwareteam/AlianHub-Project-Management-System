const { SCHEMA_TYPE } = require('./schemaType');
const { ACTIVE_SEAT } = require('./seatStatus');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const NOT_A_MEMBER = 'Only active members of this company can be named here.';

const namedIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [ids])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String))];

/* The ids in `ids` that hold no live seat in the company. A read failure throws rather than answering "everyone is
 * a member", so a write that names people fails closed. */
const nonMembersOf = async (companyId, ids) => {
    const wanted = namedIds(ids);
    if (!wanted.length) return [];
    const candidates = wanted.filter((id) => OBJECT_ID.test(id));
    const seats = candidates.length && companyId
        ? await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ ...ACTIVE_SEAT, userId: { $in: candidates } }, { userId: 1 }],
        }, 'find')
        : [];
    const members = new Set((seats || []).map((seat) => String(seat.userId)));
    return wanted.filter((id) => !members.has(id));
};

const allMembers = async (companyId, ids) => (await nonMembersOf(companyId, ids)).length === 0;

module.exports = { NOT_A_MEMBER, namedIds, nonMembersOf, allMembers };
