const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { activeMemberIds } = require('../notification/activeMembers');
const { CHANNEL_THREAD } = require('../Comments/helpers/conversation');

const find = async (companyId, type, filter, fields) => (await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || [];
const idOf = (value) => String(value || '');
const ids = (list) => [].concat(list || []).map(idOf).filter(Boolean);
const isLive = (row) => Number(row.deletedStatusKey || 0) === 0;
const countKey = (spaceId, listId, threadId) => `task_${spaceId}_${listId}_${threadId}_comments`;

/* A direct message with someone who has left the company is no longer listed, so its count is not either. */
const directKeys = async (companyId, uid, spaceIds) => {
    if (!spaceIds.length) return [];
    const conversations = (await find(companyId, SCHEMA_TYPE.TASKS,
        { mainChat: true, AssigneeUserId: uid, ProjectID: { $in: idForms(spaceIds) } },
        { ProjectID: 1, sprintId: 1, AssigneeUserId: 1, agentId: 1, deletedStatusKey: 1 })).filter(isLive);
    const peerOf = (row) => ids(row.AssigneeUserId).find((id) => id !== uid) || '';
    const active = new Set(await activeMemberIds(companyId, conversations.filter((row) => !row.agentId).map(peerOf)));
    return conversations
        .filter((row) => row.agentId || active.has(peerOf(row)))
        .map((row) => countKey(idOf(row.ProjectID), idOf(row.sprintId), idOf(row._id)));
};

const channelKeys = async (companyId, uid, spaceIds) => {
    if (!spaceIds.length) return [];
    const privileged = isPrivileged(await getRoleType(companyId, uid));
    const channels = (await find(companyId, SCHEMA_TYPE.SPRINTS,
        { projectId: { $in: idForms(spaceIds) } },
        { projectId: 1, private: 1, AssigneeUserId: 1, deletedStatusKey: 1 })).filter(isLive);
    return channels
        .filter((row) => row.private !== true || privileged || ids(row.AssigneeUserId).includes(uid))
        .map((row) => countKey(idOf(row.projectId), idOf(row._id), CHANNEL_THREAD));
};

/* The unread-count keys of every conversation the Chat page lists for this person, so a badge sums exactly those
 * and a count left behind by a deleted or closed conversation is never shown. `spaces` lets the reader notice a
 * count for a conversation that started after it asked. */
const chatUnreadKeys = async (companyId, uid) => {
    const person = idOf(uid);
    const spaces = await find(companyId, SCHEMA_TYPE.MAIN_CHATS, {}, { _id: 1, default: 1 });
    const [direct, channels] = await Promise.all([
        directKeys(companyId, person, ids(spaces.filter((space) => space.default === true).map((space) => space._id))),
        channelKeys(companyId, person, ids(spaces.filter((space) => space.default !== true).map((space) => space._id))),
    ]);
    return { spaces: ids(spaces.map((space) => space._id)), direct, channels };
};

module.exports = { chatUnreadKeys };
