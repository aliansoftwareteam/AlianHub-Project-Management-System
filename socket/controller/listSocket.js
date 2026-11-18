const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { findRoomsByPrefix } = require('../helper');
const { COMPANY_ROOM, inOrder, mayReceiveCompany, mayReceiveProject, seesList } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const LIST_EVENT = 'listChanged';
const FOLDER_EVENT = 'foldersChanged';
const KINDS = { insert: 'added', update: 'changed' };
const REMOVED = 'removed';
const TRASHED = 1;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const stored = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, {
    type, data: [{ _id: new mongoose.Types.ObjectId(id) }, fields],
}, 'findOne');

/* What a person who may open the project is told of a list: a private list is told to the people the list
 * route answers it to, and to the people a change of its sharing took it from, as gone. */
const listKindFor = async (identity, change, list, kind) => {
    if (await seesList(identity, list)) return kind;
    return change.sharedBefore && await seesList(identity, change.sharedBefore) ? REMOVED : null;
};

/* Only the fact and the ids are sent, to each person and never to a room, and who that is comes from the stored
 * row, not from the event: a list or a folder is never named to someone the project's list route would not
 * answer it to. Each browser reads the project's lists or folders again through that route. A chat channel or
 * category sits in no project, so it reaches nobody here. */
const relayOf = ({ event, type, fields, idKey, kindFor }) => (change) => {
    const companyId = String((change && change.companyId) || '');
    const id = String((change && change.data && change.data._id) || '');
    const room = `${COMPANY_ROOM}${companyId}`;
    if (!companyId || !OBJECT_ID.test(id) || !KINDS[change.type] || !findRoomsByPrefix(room).length) return undefined;
    return inOrder(async () => {
        const row = await stored(companyId, type, id, fields);
        const projectId = String((row && row.projectId) || '');
        if (!OBJECT_ID.test(projectId)) return;
        const kind = Number(row.deletedStatusKey) === TRASHED ? REMOVED : KINDS[change.type];
        const entries = findRoomsByPrefix(room).filter((entry) => entry.socket && entry.socket.identity);
        // Asked together: every other relay waits behind this one, and a person's tabs share one answer.
        const toldAs = async ({ identity }) => ((await mayReceiveCompany(identity, companyId)) && (await mayReceiveProject(identity, change, projectId))
            ? kindFor(identity, change, row, kind)
            : null);
        const told = await Promise.all(entries.map((entry) => toldAs(entry.socket)));
        entries.forEach((entry, at) => {
            if (told[at] && entry.socket.rooms.has(entry.roomName)) entry.socket.emit(event, { kind: told[at], companyId, projectId, [idKey]: id });
        });
    });
};

const relayList = relayOf({
    event: LIST_EVENT, type: SCHEMA_TYPE.SPRINTS, idKey: 'sprintId', kindFor: listKindFor,
    fields: { projectId: 1, private: 1, AssigneeUserId: 1, deletedStatusKey: 1 },
});

const relayFolder = relayOf({
    event: FOLDER_EVENT, type: SCHEMA_TYPE.FOLDERS, idKey: 'folderId', kindFor: (identity, change, folder, kind) => kind,
    fields: { projectId: 1, deletedStatusKey: 1 },
});

['insert', 'update'].forEach((type) => {
    socketEmitter.on(`sprints:${type}`, relayList);
    socketEmitter.on(`folders:${type}`, relayFolder);
});

module.exports = { LIST_EVENT, FOLDER_EVENT, relayList, relayFolder };
