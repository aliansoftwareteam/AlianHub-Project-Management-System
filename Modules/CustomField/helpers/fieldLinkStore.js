const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const relationship = require('../fieldTypes/relationship');
const voting = require('../fieldTypes/voting');

/* What a relationship or a voting field holds on one task is kept here, not on the task: a task document goes whole to
 * everyone who can open that task (the task query, the socket, webhooks), and a linked task or a voter is shown only to
 * a viewer entitled to it. The task itself carries a marker, { _id, fieldValue, revision }: fieldValue is '' for a
 * relationship and the number of votes for a voting field, and revision moves on every write so an open view asks again.
 * This file is the store alone; who may read or write through it is helpers/fieldLinks.js. */

const RELATIONSHIP = relationship.type;
const VOTING = voting.type;
const DUPLICATE_KEY = 11000;

const { isId } = relationship;
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const pathOf = (fieldId) => `customField.${fieldId}`;
const withIds = (doc) => ({ ...doc, ids: (doc.ids || []).map(String) });

const links = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELD_LINKS, data }, method);

const linkDocs = async (companyId, filter) => ((await links(companyId, [filter], 'find')) || []).map(plain).map(withIds);

/* Ids of one kind are never read as the other's. */
const storedIds = async (companyId, { taskId, fieldId, kind }) => {
    const [doc] = await linkDocs(companyId, { taskId, fieldId, kind });
    return doc ? doc.ids : [];
};

/* Two first writes for one task and field both try to insert, and the unique index refuses the later one; run again, it updates. */
const upserting = (write) => write().catch((error) => (error && error.code === DUPLICATE_KEY ? write() : Promise.reject(error)));

const saveIds = (companyId, { taskId, fieldId, kind, ids }) => upserting(() => links(companyId, [
    { taskId, fieldId }, { $set: { kind, ids } }, { upsert: true, returnDocument: 'after' },
], 'findOneAndUpdate'));

let lastRevision = 0;
const nextRevision = () => {
    lastRevision = Math.max(Date.now(), lastRevision + 1);
    return lastRevision;
};

const markerOf = (fieldId, fieldValue = '') => ({ _id: String(fieldId), fieldValue, revision: nextRevision() });

/* `newerThan` leaves the task alone when it already carries the marker of a later write to the same field. */
const markTask = async (companyId, { taskId, fieldId, marker, announce = true, newerThan = null }) => {
    const path = pathOf(fieldId);
    const unseen = newerThan === null ? {} : { $or: [{ [`${path}.version`]: { $lt: newerThan } }, { [`${path}.version`]: { $exists: false } }] };
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(taskId), ...unseen }, { $set: { [path]: marker } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated && announce) socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: { [path]: marker }, module: 'task' });
    return updated;
};

/* One vote is one write: the voter goes in or out of the stored voters and the document's version steps, together, and
 * what comes back is the document as that write left it. Nothing is read a second time to count. Answers null when
 * there is nothing to withdraw from. */
const changeVote = async (companyId, { taskId, fieldId }, voter, vote) => {
    const change = { [vote ? '$addToSet' : '$pull']: { ids: String(voter) }, $inc: { version: 1 } };
    const after = await upserting(() => links(companyId, [{ taskId, fieldId, kind: VOTING }, change, { upsert: vote === true, returnDocument: 'after' }], 'findOneAndUpdate'));
    return after ? withIds(plain(after)) : null;
};

/* The count on the task is the number of voters that write left. Two votes can reach the task in either order, so each
 * carries its document's version and the task keeps the later one. No votes is no value: the marker stays, without one. */
const storeTally = (companyId, doc) => markTask(companyId, {
    taskId: doc.taskId,
    fieldId: doc.fieldId,
    newerThan: doc.version,
    marker: { _id: String(doc.fieldId), ...(doc.ids.length ? { fieldValue: doc.ids.length } : {}), revision: nextRevision(), version: doc.version },
});

/* A person's votes are theirs, so erasing the person withdraws each one and corrects its count. A member who is removed
 * from the company keeps their votes, as they keep their comments: the seat can be given back. */
const eraseVoter = async (companyId, userId) => {
    const voter = String(userId || '');
    if (!isId(voter)) return 0;
    const voted = await linkDocs(companyId, { kind: VOTING, ids: voter });
    for (const doc of voted) {
        const after = await changeVote(companyId, doc, voter, false);
        if (after) await storeTally(companyId, after);
    }
    return voted.length;
};

/* For tasks that no longer exist: what their own fields held, and their place in other tasks' relationship fields. */
const removeLinksOfTasks = async (companyId, taskIds) => {
    const gone = [...new Set((taskIds || []).map(String))].filter(isId);
    if (!gone.length) return;
    await links(companyId, [{ taskId: { $in: gone } }], 'deleteMany');
    await links(companyId, [{ kind: RELATIONSHIP, ids: { $in: gone } }, { $pull: { ids: { $in: gone } } }], 'updateMany');
};

module.exports = {
    RELATIONSHIP, VOTING, oid, pathOf, linkDocs, storedIds, saveIds, markerOf, markTask, changeVote, storeTally, eraseVoter, removeLinksOfTasks,
};
