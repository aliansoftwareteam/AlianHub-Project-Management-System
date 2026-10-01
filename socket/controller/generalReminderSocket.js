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
const { onJoin, roomFor, isSelf, toSeated } = require('../roomAccess');

const handleReminderChange = (changeData) => {
    if (!changeData || changeData.module !== 'generalReminder') return undefined;
    const doc = changeData.data || {};
    const ownerId = doc.userId;
    if (!ownerId) return undefined;

    // Notify the recipient, and — when the reminder was raised for someone else
    // — the author too, so their "Assigned by me" list stays live.
    const targets = new Set([String(ownerId)]);
    if (doc.createdBy && String(doc.createdBy) !== String(ownerId)) {
        targets.add(String(doc.createdBy));
    }

    const emitData = { type: changeData.type, fullDocument: doc };

    // The room is named by the user alone, and a person in two companies has one in each.
    const rooms = [...targets].flatMap((uid) => findRoomsByPrefix(`generalReminder_${uid}`));
    return toSeated(rooms, changeData.companyId, (data) => data.namespace.to(data.roomName).emit('generalReminderUpdate', emitData));
};

exports.generalReminderSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinGeneralReminder', (data, identity) => isSelf(identity, data.uid), (data) => {
        const roomName = roomFor(socket, `generalReminder_${data.uid}`);
        joinRoom(socket, roomName);
        upsertRoom({
            roomName,
            socketId: socket.id,
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
