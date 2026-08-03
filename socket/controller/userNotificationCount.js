const {
    isSelf,
    joinRoom,
    leaveRoom,
    upsertRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const handleUserNotificationChange = (changeData) => {
    if (changeData.module !== 'userIdNotification') return;
    // A findOneAndUpdate that matched nothing resolves to null. Reading .userId off
    // it threw here, and broadcasting it would have replaced the client's entire
    // count store with null — wiping every badge.
    if (!changeData.data || !changeData.data.userId) return;

    const userIdIdentifier = `userIdNotification_${changeData.data.userId}`;
    // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): O(1) prefix lookup.
    const relatedRooms = findRoomsByPrefix(userIdIdentifier);
    if (!relatedRooms.length) return;

    const emitData = { fullDocument: changeData.data };

    relatedRooms.forEach(data => {
        // SOCKET-PERFORMANCE-PLAN #5 (Phase 2): see taskSocket.js for context.
        if (!data.socket.rooms.has(data.roomName)) return;
        data.namespace.to(data.roomName).emit('userIdNoticationUpdate', emitData);
    });
};

exports.userNotificationCountHandler = ({ socket, namespace }) => {
    socket.on('joinUserIdNotification', (data) => {
        // Keyed by user id and carries that user's counter document — so the id must
        // be the authenticated caller's, not whatever the client asked for.
        if (!data || !isSelf(socket, data.uid)) return;

        const roomName = `userIdNotification_${data.uid}**${data.socketId}`;
        joinRoom(socket, roomName);
        upsertRoom({
            roomName,
            socketId: data.socketId,
            namespace,
            socket,
            isUserIdCheck: data.userId ? true : false,
            userId: data.userId,
        });
    });
};

// SOCKET-PERFORMANCE-PLAN #2: scoped to the `userIdNotification` module
// only. Previously this fired for every task/comment/companies update too,
// even though the early `module` check exited within a few lines — the
// scan over socketRef.rooms still ran on the wrong path.
socketEmitter.on('userIdNotification:update', changeData => handleUserNotificationChange(changeData, true));
socketEmitter.on('userIdNotification:insert', changeData => handleUserNotificationChange(changeData, false));
