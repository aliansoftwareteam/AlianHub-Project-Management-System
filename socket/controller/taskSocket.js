const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefixes,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, prefixOfOwnRoom, isSelf, canOpenTask, canOpenSprintBoard, mayReceiveTask, inOrder } = require('../roomAccess');
const { extraListsOf } = require('../../Modules/Tasks/helpers/taskExtraListsRules');

function setEventName(type) {
    switch (type) {
        case 'insert': return 'taskInsert';
        case 'update': return 'taskUpdate';
        case 'delete': return 'taskDelete';
        case 'replace': return 'taskReplace';
    }
}

const listRoom = (projectId, sprintId) => `project_sprint_${projectId}_${sprintId}`;

/* The rooms of the lists a task was added to, and of the ones this change took it out of
 * (`leftLists`, set by the writer), so a removal reaches the list it left. A conversation row is in no list but its own. */
const extraListRooms = (changeData) => {
    if (changeData.data.mainChat === true) return [];
    const home = String(changeData.data.sprintId);
    const entries = [...extraListsOf(changeData.data), ...(Array.isArray(changeData.leftLists) ? changeData.leftLists : [])];
    return [...new Set(entries.filter((entry) => entry && String(entry.sprintId) !== home).map((entry) => listRoom(entry.projectId, entry.sprintId)))];
};

/* A task event goes to the list it lives in, to its own detail pane, to its parent's, and to the lists it was added to. */
const roomsOf = (changeData) => {
    const { data } = changeData;
    const rooms = findRoomsByPrefixes(
        listRoom(data.ProjectID, data.sprintId),
        `taskDetail_${data._id}`,
        `taskDetail_${data.ParentTaskId}`,
        ...extraListRooms(changeData),
    );
    return [...new Map(rooms.map((room) => [room.roomName, room])).values()];
};

const deliver = (room, changeData, eventName, emitData) => {
    if (room.isUserIdCheck) {
        const userId = room.namespace.name.split('_').pop();
        if (![].concat(changeData.data.AssigneeUserId || []).map(String).includes(userId)) return;
        room.namespace.to(room.roomName).emit(eventName, emitData);
        return;
    }
    if (!room.roomName.includes('taskDetail_')) {
        room.namespace.to(room.roomName).emit(eventName, emitData);
        return;
    }
    // A detail pane also hears the subtasks of the task it shows, marked as such.
    const shownTaskId = room.roomName.split('**')[0].split('_')[1];
    const own = String(changeData.data._id) === shownTaskId;
    room.namespace.to(room.roomName).emit(`taskDetail_${eventName}`, own ? emitData : { ...emitData, isSubTaskUpdate: true });
};

const relayTaskChange = async (changeData, includeUpdatedFields) => {
    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
        ...(changeData.leftBecause && { leftBecause: changeData.leftBecause }),
    };
    // A room of an added list was joined on that list alone, so every socket is judged on the task's home.
    for (const room of roomsOf(changeData)) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceiveTask(room.socket.identity, changeData))) continue;
        if (room.socket.rooms.has(room.roomName)) deliver(room, changeData, eventName, emitData);
    }
};

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module !== 'task' || !changeData.data || !roomsOf(changeData).length) return undefined;
    return inOrder(() => relayTaskChange(changeData, includeUpdatedFields));
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

socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
