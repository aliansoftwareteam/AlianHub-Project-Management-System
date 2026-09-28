const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { activeMemberIds } = require('../../notification/activeMembers');
const { updateUnReadCommentsCountFun } = require('../../notification-count/controller');
const { threadOf } = require('./threadWriteAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const idsOf = (list) => (Array.isArray(list) ? list : []).filter(Boolean).map(String);

const findById = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, {
    type,
    data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, fields],
}, 'findOne');

const spaceOf = async (companyId, projectId) => (await findById(companyId, SCHEMA_TYPE.PROJECTS, projectId, { watchers: 1 }))
    || findById(companyId, SCHEMA_TYPE.MAIN_CHATS, projectId, { _id: 1 });

const companyMemberIds = async (companyId) => idsOf((await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ ...ACTIVE_SEAT }, { userId: 1 }],
}, 'find') || []).map((seat) => seat.userId));

/* The people the comment panels counted as taking part: a sprint channel's members (everyone for a public
 * channel), a direct message's two people, a task's watchers, or a project's watchers. */
const participantsOf = async (companyId, thread, space) => {
    if (thread.taskId === 'default') {
        const channel = isId(thread.sprintId)
            ? await findById(companyId, SCHEMA_TYPE.SPRINTS, thread.sprintId, { private: 1, AssigneeUserId: 1 })
            : null;
        if (!channel) return null;
        return { userIds: channel.private ? idsOf(channel.AssigneeUserId) : await companyMemberIds(companyId) };
    }
    if (isId(thread.taskId)) {
        const task = await findById(companyId, SCHEMA_TYPE.TASKS, thread.taskId, { watchers: 1, AssigneeUserId: 1, mainChat: 1, ParentTaskId: 1 });
        if (!task) return null;
        return { userIds: idsOf(task.mainChat === true ? task.AssigneeUserId : task.watchers), parentTaskId: task.ParentTaskId };
    }
    return { userIds: Object.keys(space.watchers || {}) };
};

/* A project watcher set to all activity hears every thread; one set to ignore hears none of it. */
const recipientsOf = (prefs, participants, authorId) => {
    const everything = Object.keys(prefs).filter((uid) => prefs[uid] === 'all_activity');
    const listening = participants.filter((uid) => prefs[uid] !== 'ignore');
    return [...new Set([...everything, ...listening])].filter((uid) => uid !== String(authorId));
};

const threadCountFields = (thread, parentTaskId) => (thread.taskId
    ? { key: 2, sprintId: thread.sprintId, taskId: thread.taskId, ...(parentTaskId ? { parentTaskId: String(parentTaskId) } : {}) }
    : { key: 1 });

const bumpUnreadCounts = async (companyId, comment, mentionIds = []) => {
    const thread = threadOf(comment);
    if (!isId(thread.projectId)) return;
    const space = await spaceOf(companyId, thread.projectId);
    if (!space) return;
    const participants = await participantsOf(companyId, thread, space);
    if (!participants) return;

    const mentioned = idsOf(mentionIds).filter((uid) => uid !== String(comment.userId));
    const prefs = space.watchers && typeof space.watchers === 'object' && !Array.isArray(space.watchers) ? space.watchers : {};
    const userIds = await activeMemberIds(companyId, recipientsOf(prefs, [...participants.userIds, ...mentioned], comment.userId));

    const writes = [];
    if (userIds.length) {
        writes.push(updateUnReadCommentsCountFun({ body: {
            companyId, projectId: thread.projectId, userIds, ...threadCountFields(thread, participants.parentTaskId),
        } }));
    }
    if (mentioned.length) {
        writes.push(updateUnReadCommentsCountFun({ body: { companyId, key: 4, userIds: mentioned, readAll: false } }));
    }
    await Promise.all(writes);
};

module.exports = { bumpUnreadCounts };
