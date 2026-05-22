const {joinRoom,leaveRoom} = require('../helper');
const socketRef = require('../socketinit');
const socketEmitter = require('../../event/socketEventEmitter');
const handleUserNotificationChange = (changeData) => {
    if (changeData.module === 'userIdNotification') {
        const userIdIdentifier = `userIdNotification_${changeData.data.userId}`;
        const relatedRooms = socketRef.rooms.filter(x => x.roomName.includes(userIdIdentifier));
        relatedRooms.forEach(data => {
            const eventName = 'userIdNoticationUpdate';
            const userCountIdefier = `${userIdIdentifier}**${data.socketId}`;
            const matchingRooms = [...new Set(
                Array.from(data.namespace.adapter.rooms.keys())
                    .filter((roomName) => {
                        let socId = roomName.split("**");
                        if (socId.length > 1 && socId[1] === data.socketId) {
                            return (
                                (roomName.includes(userCountIdefier) && data.roomName.includes(userCountIdefier)) 
                            )
                        }
                    })
            )];
            const emitData = {
                fullDocument: changeData.data,
            };
            matchingRooms.forEach(room => {
                data.namespace.to(room).emit(`${eventName}`, emitData);
            });
        })
    }
};

exports.userNotificationCountHandler = ({socket, namespace}) => {
    socket.on('joinUserIdNotification',(data)=>{
        const roomName = `userIdNotification_${data.uid}**${data.socketId}`;
        joinRoom(socket,roomName);
        socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket,isUserIdCheck: data.userId ? true : false, userId: data.userId});
    });
}

// SOCKET-PERFORMANCE-PLAN #2: scoped to the `userIdNotification` module
// only. Previously this fired for every task/comment/companies update too,
// even though the early `module` check exited within a few lines — the
// scan over socketRef.rooms still ran on the wrong path.
socketEmitter.on('userIdNotification:update', changeData => handleUserNotificationChange(changeData, true));
socketEmitter.on('userIdNotification:insert', changeData => handleUserNotificationChange(changeData, false));
