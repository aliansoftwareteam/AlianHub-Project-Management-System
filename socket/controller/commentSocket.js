const socketRef = require('../socketinit');
const {joinRoom,leaveRoom} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
exports.commentSocketHandler = ({socket, namespace}) => {
    socket.on('joinCommentRoom',(data)=>{
        const roomName = data.roomName;
        joinRoom(socket,roomName);
        const existingIndex = socketRef.rooms.findIndex((x) => x.roomName === roomName && x.socketId === data.socketId);
        if (existingIndex === -1) {
            socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket});
        } else {
            socketRef.rooms[existingIndex] = {roomName, socketId: data.socketId,namespace,socket};
        }
    });
    socket.on('leaveCommentRoom',(roomName)=>{
        for (let index = socketRef.rooms.length - 1; index >= 0; index--) {
            if (socketRef.rooms[index].roomName === roomName) {
                socketRef.rooms.splice(index, 1);
            }
        }
        leaveRoom(socket,roomName);
    })
}
function setEventName(type) {
    let eventName;
    switch (type) {
        case 'insert': { 
            eventName = 'commentInsert'
            break;
        }
        case 'update': { 
            eventName = 'commentUpdate'
            break;
        }
        case 'delete': { 
            eventName = 'commentDelete'
            break;
        }
        case 'replace': { 
            eventName = 'commentReplace'
            break;
        }
    }
    return eventName;
}
const handleCommentChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module === 'comments') {
        // SOCKET-PERFORMANCE-PLAN #3: dropped three back-to-back deep clones of
        // the full comment document; field access on the doc directly works
        // for both plain objects and Mongoose documents.
        const { projectId, sprintId, taskId } = changeData.data;
        const comentIdentifier = `comments_${projectId}_${sprintId}_${taskId}`;
        const relatedRooms = uniqueRooms(socketRef.rooms.filter(x => x.roomName.includes(comentIdentifier)));
        
        relatedRooms.forEach(data => {
            const eventName = setEventName(changeData.type);
            const comment = `${comentIdentifier}**${data.socketId}`;
            const matchingRooms = [...new Set(
                Array.from(data.namespace.adapter.rooms.keys())
                    .filter((roomName) => {
                        let socId = roomName.split("**");
                        if (socId.length > 1 && socId[1] === data.socketId) {
                            return (
                                (roomName.includes(comment) && data.roomName.includes(comment)) 
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

    if (changeData.module === 'comments_project') {
        // SOCKET-PERFORMANCE-PLAN #3: same dedup-via-clone removal as above.
        const comentProjectIdentifier = `comments_project_${changeData.data.projectId}`;
        const relatedRooms = uniqueRooms(socketRef.rooms.filter(x => x.roomName.includes(comentProjectIdentifier)));
        
        relatedRooms.forEach(data => {
            const eventName = setEventName(changeData.type);
            const commentProject = `${comentProjectIdentifier}**${data.socketId}`;
            const matchingRooms = [...new Set(
                Array.from(data.namespace.adapter.rooms.keys())
                    .filter((roomName) => {
                        let socId = roomName.split("**");
                        if (socId.length > 1 && socId[1] === data.socketId) {
                            return (
                                (roomName.includes(commentProject) && data.roomName.includes(commentProject)) 
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

function uniqueRooms(rooms) {
    const seen = new Set();
    return rooms.filter((room) => {
        const key = `${room.roomName}**${room.socketId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// SOCKET-PERFORMANCE-PLAN #2: comments are published under two modules —
// `comments` (task-level comments) and `comments_project` (project-level
// comments). Subscribe to both namespaces so the handler still receives
// every relevant event while ignoring task/companies/notification fan-out.
socketEmitter.on('comments:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments:insert', changeData => handleCommentChange(changeData, false));
socketEmitter.on('comments_project:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments_project:insert', changeData => handleCommentChange(changeData, false));
