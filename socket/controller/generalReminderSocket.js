// Real-time relay for general-purpose reminders. Mirrors
// userNotificationCount.js: the client joins a room keyed by its own user id,
// and every create/update/delete on that user's reminders is pushed to it.
//
// Scoped to the `generalReminder` module only (SOCKET-PERFORMANCE-PLAN #2), so
// this handler never wakes for task/comment/company traffic.
const {
    joinRoom,
    upsertRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const handleReminderChange = (changeData) => {
    if (!changeData || changeData.module !== 'generalReminder') return;
    const ownerId = changeData.data && changeData.data.userId;
    if (!ownerId) return;

    const identifier = `generalReminder_${ownerId}`;
    // O(1) prefix lookup into the room index.
    const relatedRooms = findRoomsByPrefix(identifier);
    if (!relatedRooms.length) return;

    const emitData = { type: changeData.type, fullDocument: changeData.data };

    relatedRooms.forEach((data) => {
        // The socket may have left between index write and emit.
        if (!data.socket.rooms.has(data.roomName)) return;
        data.namespace.to(data.roomName).emit('generalReminderUpdate', emitData);
    });
};

exports.generalReminderSocketHandler = ({ socket, namespace }) => {
    socket.on('joinGeneralReminder', (data) => {
        if (!data || !data.uid) return;
        const roomName = `generalReminder_${data.uid}**${data.socketId}`;
        joinRoom(socket, roomName);
        upsertRoom({
            roomName,
            socketId: data.socketId,
            namespace,
            socket,
            isUserIdCheck: data.uid ? true : false,
            userId: data.uid,
        });
    });
};

socketEmitter.on('generalReminder:insert', (changeData) => handleReminderChange(changeData));
socketEmitter.on('generalReminder:update', (changeData) => handleReminderChange(changeData));
socketEmitter.on('generalReminder:delete', (changeData) => handleReminderChange(changeData));
