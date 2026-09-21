const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefixes,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, prefixOfOwnRoom, isSelf, projectReadable } = require('../roomAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function setEventName(type) {
    switch (type) {
        case 'insert': return 'chatTaskInsert';
        case 'update': return 'chatTaskUpdate';
        case 'delete': return 'chatTaskDelete';
        case 'replace': return 'chatTaskReplace';
    }
}

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module !== 'task' || changeData.data.mainChat !== true) return;

    // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): chat events broadcast to both
    // participants in a 1:1 task chat. The room prefix is
    // `chat_<projectId>_<userId>` per participant; look up both in one pass.
    const chatIdentifier = `chat_${changeData.data.ProjectID}_${changeData.data.AssigneeUserId[0]}`;
    const chatIdentifier1 = `chat_${changeData.data.ProjectID}_${changeData.data.AssigneeUserId[1]}`;
    const relatedRooms = findRoomsByPrefixes(chatIdentifier, chatIdentifier1);
    if (!relatedRooms.length) return;

    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };

    relatedRooms.forEach(data => {
        if (!data.socket.rooms.has(data.roomName)) return;
        data.namespace.to(data.roomName).emit(eventName, emitData);
    });
};

exports.chatSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinChats',
        (data, identity) => isSelf(identity, data.userId) && OBJECT_ID.test(String(data.projectId || '')) && projectReadable(identity, data.projectId),
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

// SOCKET-PERFORMANCE-PLAN #2: chat events live on the `task` module too —
// the chat handler only forwards events where `mainChat === true`, so it
// shares the same namespace as the task handler.
socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
