const {joinRoom,leaveRoom} = require('../helper');
const socketRef = require('../socketinit');
const socketEmitter = require('../../event/socketEventEmitter');
function setEventName(type) {
    let eventName;
    switch (type) {
        case 'insert': { 
            eventName = 'chatTaskInsert'
            break;
        }
        case 'update': { 
            eventName = 'chatTaskUpdate'
            break;
        }
        case 'delete': { 
            eventName = 'chatTaskDelete'
            break;
        }
        case 'replace': { 
            eventName = 'chatTaskReplace'
            break;
        }
    }
    return eventName;
}

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module === 'task' && changeData.data.mainChat === true) {
        const chatIdentifier = `chat_${changeData.data.ProjectID}_${changeData.data.AssigneeUserId[0]}`;
        const chatIdentifier1 = `chat_${changeData.data.ProjectID}_${changeData.data.AssigneeUserId[1]}`;
        const relatedRooms = socketRef.rooms.filter(x => x.roomName.includes(chatIdentifier) || x.roomName.includes(chatIdentifier1));
        
        relatedRooms.forEach(data => {
            const eventName = setEventName(changeData.type);
            const chat = `${chatIdentifier}**${data.socketId}`;
            const chat1 = `${chatIdentifier1}**${data.socketId}`;
            const matchingRooms = [...new Set(
                Array.from(data.namespace.adapter.rooms.keys())
                    .filter((roomName) => {
                        let socId = roomName.split("**");
                        if (socId.length > 1 && socId[1] === data.socketId) {
                            return (
                                (roomName.includes(chat) && data.roomName.includes(chat)) 
                                || (roomName.includes(chat1) && data.roomName.includes(chat1)) 
                            )
                        }
                    })
            )];
            const emitData = {
                fullDocument: changeData.data,
                ...(includeUpdatedFields && { updatedFields: changeData.updatedFields })
            };

            matchingRooms.forEach(room => {
                data.namespace.to(room).emit(`${eventName}`, emitData);
            });
        });
    }
};

exports.chatSocketHandler = ({socket, namespace}) => {
    socket.on('joinChats',(data)=>{
        const roomName = `chat_${data.projectId}_${data.userId}**${data.socketId}`;
        joinRoom(socket,roomName);
        socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket});
    });
    socket.on('leaveChats',(roomName)=>{
        let index = socketRef.rooms.findIndex((x)=> x.roomName === roomName);        
        if (index !== -1) {
            socketRef.rooms.splice(index, 1);
        }
        leaveRoom(socket,roomName);
    })
}

// SOCKET-PERFORMANCE-PLAN #2: chat events live on the `task` module too —
// the chat handler only forwards events where `mainChat === true`, so it
// shares the same namespace as the task handler.
socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
