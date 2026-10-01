const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefixes,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, prefixOfOwnRoom, isSelf, canOpenChats, mayReceiveTask, inOrder } = require('../roomAccess');

function setEventName(type) {
    switch (type) {
        case 'insert': return 'chatTaskInsert';
        case 'update': return 'chatTaskUpdate';
        case 'delete': return 'chatTaskDelete';
        case 'replace': return 'chatTaskReplace';
    }
}

/* A conversation goes to the chat list of each of its two participants, `chat_<spaceId>_<userId>`. */
const roomsOf = ({ data }) => {
    const participants = [].concat(data.AssigneeUserId || []);
    return findRoomsByPrefixes(`chat_${data.ProjectID}_${participants[0]}`, `chat_${data.ProjectID}_${participants[1]}`);
};

const relayChatChange = async (changeData, includeUpdatedFields) => {
    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };
    for (const room of roomsOf(changeData)) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceiveTask(room.socket.identity, changeData))) continue;
        if (room.socket.rooms.has(room.roomName)) room.namespace.to(room.roomName).emit(eventName, emitData);
    }
};

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module !== 'task' || !changeData.data || changeData.data.mainChat !== true) return undefined;
    if (!roomsOf(changeData).length) return undefined;
    return inOrder(() => relayChatChange(changeData, includeUpdatedFields));
};

exports.chatSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinChats',
        (data, identity) => isSelf(identity, data.userId) && canOpenChats(identity, data.projectId),
        (data) => {
            const roomName = roomFor(socket, `chat_${data.projectId}_${data.userId}`);
            joinRoom(socket, roomName);
            upsertRoom({ roomName, socketId: socket.id, namespace, socket });
        });
    socket.on('leaveChats', (roomName) => {
        if (!prefixOfOwnRoom(socket, roomName)) return;
        removeRoom(roomName);
        leaveRoom(socket, roomName);
    });
};

socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
