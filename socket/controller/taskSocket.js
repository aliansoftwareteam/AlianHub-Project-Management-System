const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefixes,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, prefixOfOwnRoom, isSelf, canOpenTask, canReadTaskRow, canOpenSprintBoard } = require('../roomAccess');
const { extraListsOf } = require('../../Modules/Tasks/helpers/taskExtraListsRules');
const logger = require('../../Config/loggerConfig');

function setEventName(type) {
    switch (type) {
        case 'insert': return 'taskInsert';
        case 'update': return 'taskUpdate';
        case 'delete': return 'taskDelete';
        case 'replace': return 'taskReplace';
    }
}

const listRoom = (projectId, sprintId) => `project_sprint_${projectId}_${sprintId}`;

const deliver = (room, changeData, eventName, emitData) => {
    // socket.rooms is a small Set, so this liveness check is O(1); scanning the adapter's rooms per entry was not.
    if (!room.socket.rooms.has(room.roomName)) return;

    if (room.isUserIdCheck) {
        const userId = room.namespace.name.split('_').pop();
        if (![].concat(changeData.data.AssigneeUserId || []).map(String).includes(userId)) return;
        room.namespace.to(room.roomName).emit(eventName, emitData);
        return;
    }

    if (room.roomName.includes('taskDetail_')) {
        // A detail pane also hears the subtasks of the task it shows, marked as such.
        const taskId = room.roomName.split('**')[0].split('_')[1];
        const own = String(changeData.data._id) == taskId;
        room.namespace.to(room.roomName).emit(`taskDetail_${eventName}`, own ? emitData : { ...emitData, isSubTaskUpdate: true });
    } else {
        room.namespace.to(room.roomName).emit(eventName, emitData);
    }
};

/* The rooms of the lists a task was added to, and of the ones this change took it out of
 * (`leftLists`, set by the writer), so a removal reaches the list it left. */
const extraListRooms = (changeData) => {
    const home = String(changeData.data.sprintId);
    const entries = [...extraListsOf(changeData.data), ...(Array.isArray(changeData.leftLists) ? changeData.leftLists : [])];
    return [...new Set(entries.filter((entry) => entry && String(entry.sprintId) !== home).map((entry) => listRoom(entry.projectId, entry.sprintId)))];
};

/* A room of such a list was joined on that list alone, and the event carries the whole task, so
 * each socket is judged on the task's home before anything is sent to it. */
const relayToExtraLists = async (changeData, eventName, emitData, prefixes, sent) => {
    const verdicts = new Map();
    const reads = (identity) => {
        if (!identity) return false;
        const key = `${identity.companyId}:${identity.uid}`;
        if (!verdicts.has(key)) verdicts.set(key, canReadTaskRow(identity, changeData.data).catch(() => false));
        return verdicts.get(key);
    };
    for (const room of findRoomsByPrefixes(...prefixes)) {
        if (sent.has(room.roomName)) continue;
        if (await reads(room.socket.identity)) deliver(room, changeData, eventName, emitData);
    }
};

/* One at a time, so two changes to a task reach a list in the order they were made. */
let extraListRelay = Promise.resolve();

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module !== 'task') return;

    // A task event goes to the sprint board of its home, to its own detail pane and to its parent's.
    const sprintIdentifier = listRoom(changeData.data.ProjectID, changeData.data.sprintId);
    const taskDetail = `taskDetail_${changeData.data._id}`;
    const subTaskDetail = `taskDetail_${changeData.data.ParentTaskId}`;
    const relatedRooms = findRoomsByPrefixes(sprintIdentifier, taskDetail, subTaskDetail);
    const elsewhere = extraListRooms(changeData);
    if (!relatedRooms.length && !elsewhere.length) return;

    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };

    relatedRooms.forEach((room) => deliver(room, changeData, eventName, emitData));

    if (!elsewhere.length) return;
    const sent = new Set(relatedRooms.map((room) => room.roomName));
    extraListRelay = extraListRelay
        .then(() => relayToExtraLists(changeData, eventName, emitData, elsewhere, sent))
        .catch((error) => { logger.error(`task relay to extra lists: ${error && error.message}`); });
};

const leaveOwnRoom = (socket, roomName) => {
    if (!prefixOfOwnRoom(socket, roomName)) return;
    removeRoom(roomName);
    leaveRoom(socket, roomName);
};

exports.taskSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinProjectSprintForTask',
        (data, identity) => (!data.userId || isSelf(identity, data.userId)) && canOpenSprintBoard(identity, data.projectId, data.sprintId),
        (data) => {
            const roomName = roomFor(socket, `project_sprint_${data.projectId}_${data.sprintId}`);
            joinRoom(socket, roomName);
            upsertRoom({
                roomName,
                socketId: socket.id,
                namespace,
                socket,
                isUserIdCheck: data.userId ? true : false,
                userId: data.userId,
            });
        });
    socket.on('leaveProjectSprintForTask', (roomName) => leaveOwnRoom(socket, roomName));
    onJoin(socket, 'joinTaskDetail',
        (data, identity) => canOpenTask(identity, data.taskId),
        (data) => {
            const roomName = roomFor(socket, `taskDetail_${data.taskId}`);
            joinRoom(socket, roomName);
            upsertRoom({ roomName, socketId: socket.id, namespace, socket });
        });
    socket.on('leaveTaskDetail', (roomName) => leaveOwnRoom(socket, roomName));
};

// SOCKET-PERFORMANCE-PLAN #2: subscribe to module-scoped events only. The
// emitter publishes `task:update` / `task:insert` for any payload tagged
// with `module: 'task'`, so this handler stops firing for comment/company/
// notification mutations.
socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
