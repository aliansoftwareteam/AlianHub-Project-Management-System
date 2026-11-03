const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');

// Who may use an agent: its creator alone, the people and teams it is shared with, or everyone. An agent made
// before this existed has no visibility and is everyone's. Team members are read when the agent is used.

const VISIBILITY = Object.freeze({ PRIVATE: 'private', SHARED: 'shared', EVERYONE: 'everyone' });
const ORDER = Object.freeze([VISIBILITY.PRIVATE, VISIBILITY.SHARED, VISIBILITY.EVERYONE]);
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MAX_SHARED = 200;

const REFUSAL = Object.freeze({
    USE: 'This agent is not shared with you.',
    VISIBILITY: `visibility must be one of ${ORDER.join(', ')}`,
    SHARED_EMPTY: 'Choose at least one person or team to share the agent with.',
    SHARED_UNKNOWN: 'The agent is shared with someone who is not an active member, or a team that does not exist.',
});

const idsOf = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => OBJECT_ID.test(id)))].slice(0, MAX_SHARED);

const visibilityOf = (agent) => (agent && ORDER.includes(agent.visibility) ? agent.visibility : VISIBILITY.EVERYONE);

const sharedOf = (agent) => {
    const shared = (agent && agent.sharedWith) || {};
    return { userIds: idsOf(shared.userIds), teamIds: idsOf(shared.teamIds) };
};

const isCreator = (agent, userId) => Boolean(userId) && String((agent && agent.ownerId) || '') === String(userId);

/* The fields a request sets, or {} when it names neither. Throws a 400 on a value that cannot be stored. */
const audienceFields = (body = {}) => {
    const out = {};
    if (body.visibility !== undefined) {
        if (!ORDER.includes(body.visibility)) throw Object.assign(new Error(REFUSAL.VISIBILITY), { status: 400 });
        out.visibility = body.visibility;
    }
    if (body.sharedWith !== undefined) out.sharedWith = sharedOf({ sharedWith: body.sharedWith });
    if (out.visibility && out.visibility !== VISIBILITY.SHARED) out.sharedWith = { userIds: [], teamIds: [] };
    return out;
};

/* The teams a person is in, for every check of one request. */
const teamIdsOf = async (companyId, userId) => {
    if (!OBJECT_ID.test(String(userId || ''))) return [];
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TEAMS_MANAGEMENT, data: [{ assigneeUsersArray: { $in: [String(userId)] } }, { _id: 1 }] }, 'find').catch(() => []);
    return (rows || []).map((row) => String(row._id));
};

const personOf = async (companyId, userId) => ({ userId: String(userId || ''), teamIds: await teamIdsOf(companyId, userId) });

/* Whether `person` ({ userId, teamIds }) is offered the agent to work with. Owners and admins are not offered a private one. */
const mayUse = (agent, person) => {
    if (!agent || !person) return false;
    if (isCreator(agent, person.userId)) return true;
    const visibility = visibilityOf(agent);
    if (visibility === VISIBILITY.EVERYONE) return true;
    if (visibility !== VISIBILITY.SHARED) return false;
    const shared = sharedOf(agent);
    return shared.userIds.includes(String(person.userId)) || shared.teamIds.some((id) => (person.teamIds || []).includes(id));
};

/* Owners, admins and roles that may see every agent see them all; anyone else sees what they may use. */
const maySee = (agent, person, { seesAll = false } = {}) => seesAll || mayUse(agent, person);

const reachOf = (agent) => ({ visibility: visibilityOf(agent), ...sharedOf(agent) });

/* Whether going from `before` to `after` lets anyone use the agent who could not before. */
const widens = (before, after) => {
    const from = reachOf(before);
    const to = reachOf({ ...before, ...after });
    if (ORDER.indexOf(to.visibility) !== ORDER.indexOf(from.visibility)) return ORDER.indexOf(to.visibility) > ORDER.indexOf(from.visibility);
    if (to.visibility !== VISIBILITY.SHARED) return false;
    return to.userIds.some((id) => !from.userIds.includes(id)) || to.teamIds.some((id) => !from.teamIds.includes(id));
};

/* A share names only active members and teams that exist; empty when every name is good. */
const unknownShares = async (companyId, fields) => {
    if (!fields || fields.visibility !== VISIBILITY.SHARED) return [];
    const { userIds, teamIds } = sharedOf(fields);
    if (!userIds.length && !teamIds.length) return [REFUSAL.SHARED_EMPTY];
    const [members, teams] = await Promise.all([
        userIds.length ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: { $in: userIds }, ...ACTIVE_SEAT }, { userId: 1 }] }, 'find') : [],
        teamIds.length ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TEAMS_MANAGEMENT, data: [{ _id: { $in: idForms(teamIds) } }, { _id: 1 }] }, 'find') : [],
    ]);
    const found = new Set([...(members || []).map((m) => String(m.userId)), ...(teams || []).map((t) => String(t._id))]);
    return [...userIds, ...teamIds].every((id) => found.has(id)) ? [] : [REFUSAL.SHARED_UNKNOWN];
};

module.exports = {
    VISIBILITY, REFUSAL, visibilityOf, sharedOf, isCreator, audienceFields, teamIdsOf, personOf, mayUse, maySee, widens, unknownShares,
};
