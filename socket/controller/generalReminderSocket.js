// Real-time relay for general-purpose reminders. Mirrors
// userNotificationCount.js: the client joins a room keyed by its own user id,
// and every create/update/delete on that user's reminders is pushed to it.
//
// Scoped to the `generalReminder` module only (SOCKET-PERFORMANCE-PLAN #2), so
// this handler never wakes for task/comment/company traffic.
const {
    isSelf,
    joinRoom,
    upsertRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const handleReminderChange = (changeData) => {
    if (!changeData || changeData.module !== 'generalReminder') return;
    const doc = changeData.data || {};
    const ownerId = doc.userId;
    if (!ownerId) return;

    // Notify the recipient, and — when the reminder was raised for someone else
    // — the author too, so their "Assigned by me" list stays live.
    const targets = new Set([String(ownerId)]);
    if (doc.createdBy && String(doc.createdBy) !== String(ownerId)) {
        targets.add(String(doc.createdBy));
    }

    const emitData = { type: changeData.type, fullDocument: doc };

    targets.forEach((uid) => {
        // O(1) prefix lookup into the room index.
        const relatedRooms = findRoomsByPrefix(`generalReminder_${uid}`);
        relatedRooms.forEach((data) => {
            // The socket may have left between index write and emit.
            if (!data.socket.rooms.has(data.roomName)) return;
            data.namespace.to(data.roomName).emit('generalReminderUpdate', emitData);
        });
    });
};

exports.generalReminderSocketHandler = ({ socket, namespace }) => {
    socket.on('joinGeneralReminder', (data) => {
        if (!data || !data.uid) return;

        // The room is keyed by user id and carries the FULL reminder document, so the
        // id has to be the authenticated caller's — otherwise anyone who knows a
        // colleague's user id (they are visible on every assignee and mention) could
        // subscribe to their private reminders. socketinit.js already put the verified
        // JWT on socket.user; this is the check that was missing, not the identity.
        if (!isSelf(socket, data.uid)) return;

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
