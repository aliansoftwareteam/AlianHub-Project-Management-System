const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('./schemaType');
const { ACTIVE_SEAT } = require('./seatStatus');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEAM_PREFIX = 'tId_';

const NOT_A_MEMBER = 'Only active members of this company can be named here.';
const NOT_A_TEAM = 'Only teams of this company can be named here.';

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

/* The `tId_<id>` references in `refs` that name no team of the company. */
const foreignTeamsOf = async (companyId, refs) => {
    const wanted = namedIds(refs);
    if (!wanted.length) return [];
    const candidates = wanted.map((ref) => ref.slice(TEAM_PREFIX.length)).filter((id) => OBJECT_ID.test(id));
    const teams = candidates.length && companyId
        ? await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
            data: [{ _id: { $in: candidates.map((id) => new mongoose.Types.ObjectId(id)) } }, { _id: 1 }],
        }, 'find')
        : [];
    const known = new Set((teams || []).map((team) => `${TEAM_PREFIX}${team._id}`));
    return wanted.filter((ref) => !known.has(ref));
};

/* Why a write naming `ids` (people, or `tId_` team references) is refused, or '' when every one belongs here. */
const outsiderRefusal = async (companyId, ids) => {
    const wanted = namedIds(ids);
    const teams = wanted.filter((id) => id.startsWith(TEAM_PREFIX));
    if ((await nonMembersOf(companyId, wanted.filter((id) => !id.startsWith(TEAM_PREFIX)))).length) return NOT_A_MEMBER;
    if ((await foreignTeamsOf(companyId, teams)).length) return NOT_A_TEAM;
    return '';
};

const REMOVING_OPERATORS = ['$pull', '$pullAll', '$pop', '$unset'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof mongoose.Types.ObjectId);

const valuesOf = (value) => {
    if (isPlainObject(value) && Array.isArray(value.$each)) return value.$each;
    return Array.isArray(value) ? value : [value];
};

/* People fields are either lists of ids or maps keyed by id (a project's `watchers`), and a path can reach
 * into either: `AssigneeUserId.0` carries an id as its value, `watchers.<id>` carries it in the path. */
const idsAt = (path, value) => {
    const [, sub] = path.split('.');
    if (sub !== undefined) return /^\d+$/.test(sub) ? valuesOf(value) : [sub];
    if (isPlainObject(value) && !Array.isArray(value.$each)) return Object.keys(value);
    return valuesOf(value);
};

/* Every id an update document writes into `fields`. A bare document is a `$set`, and every operator but a removal
 * can bring someone in; a `$rename` into a people field moves in values this cannot see, so it names its source. */
const namedInUpdate = (update, fields) => {
    const named = [];
    const collect = (doc) => Object.entries(isPlainObject(doc) ? doc : {}).forEach(([path, value]) => {
        if (fields.includes(path.split('.')[0])) named.push(...idsAt(path, value));
    });
    (Array.isArray(update) ? update : [update]).forEach((doc) => {
        Object.entries(isPlainObject(doc) ? doc : {}).forEach(([key, value]) => {
            if (!key.startsWith('$')) collect({ [key]: value });
            else if (key === '$rename') collect(Object.fromEntries(Object.entries(isPlainObject(value) ? value : {}).map(([from, to]) => [String(to), from])));
            else if (!REMOVING_OPERATORS.includes(key)) collect(value);
        });
    });
    return namedIds(named);
};

const heldIn = (doc, fields) => new Set(fields.flatMap((field) => {
    const value = doc && doc[field];
    if (Array.isArray(value)) return value.map(String);
    return isPlainObject(value) ? Object.keys(value) : [];
}));

module.exports = { NOT_A_MEMBER, NOT_A_TEAM, TEAM_PREFIX, namedIds, nonMembersOf, allMembers, foreignTeamsOf, outsiderRefusal, namedInUpdate, heldIn };
