const {
    joinRoom,
    upsertRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, isSelf, sameCompany } = require('../roomAccess');

const handleUserNotificationChange = (changeData) => {
    if (changeData.module !== 'userIdNotification') return;
    // A findOneAndUpdate that matched nothing resolves to null, and sending it would replace the client's whole count store.
    if (!changeData.data || !changeData.data.userId) return;

    const emitData = { fullDocument: changeData.data };

    // The room is named by the user alone, and a person in two companies has one in each.
    findRoomsByPrefix(`userIdNotification_${changeData.data.userId}`).forEach(data => {
        if (!sameCompany(data.socket.identity, changeData) || !data.socket.rooms.has(data.roomName)) return;
        data.namespace.to(data.roomName).emit('userIdNoticationUpdate', emitData);
    });
};

exports.userNotificationCountHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinUserIdNotification', (data, identity) => isSelf(identity, data.uid), (data) => {
        const roomName = roomFor(socket, `userIdNotification_${data.uid}`);
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
};

socketEmitter.on('userIdNotification:update', changeData => handleUserNotificationChange(changeData, true));
socketEmitter.on('userIdNotification:insert', changeData => handleUserNotificationChange(changeData, false));
