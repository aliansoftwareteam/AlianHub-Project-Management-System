const {joinRoom,leaveRoom} = require('../helper');
const socketRef = require('../socketinit');
const socketEmitter = require('../../event/socketEventEmitter');
function setEventName(type) {
    let eventName;
    switch (type) {
        case 'insert': { 
            eventName = 'taskInsert'
            break;
        }
        case 'update': { 
            eventName = 'taskUpdate'
            break;
        }
        case 'delete': { 
            eventName = 'taskDelete'
            break;
        }
        case 'replace': { 
            eventName = 'taskReplace'
            break;
        }
    }
    return eventName;
}

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module === 'task') {
        const sprintIdentifier = `project_sprint_${changeData.data.ProjectID}_${changeData.data.sprintId}`;
        // SOCKET-PERFORMANCE-PLAN #3: dropped JSON.parse(JSON.stringify(...))
        // around `_id` access. The deep clone was used solely to coerce the
        // Mongoose ObjectId to a string for template literal interpolation —
        // template literals already call .toString() on objects, so the clone
        // was a pure allocation/GC cost on every event.
        const taskDetail = `taskDetail_${changeData.data._id}`;
        const subTaskDetail = `taskDetail_${changeData.data.ParentTaskId}`;
        const relatedRooms = socketRef.rooms.filter(x => x.roomName.includes(sprintIdentifier) || x.roomName.includes(taskDetail) || x.roomName.includes(subTaskDetail));
        
        relatedRooms.forEach(data => {
            const eventName = setEventName(changeData.type);
            if (data.isUserIdCheck) {
                
                let userId = data.namespace.name.split("_").pop();
                if (changeData.data.AssigneeUserId.includes(userId)) {
                    const projectID = `${sprintIdentifier}**${data.socketId}`;
            
                    const matchingRooms = [...new Set(
                        Array.from(data.namespace.adapter.rooms.keys())
                            .filter(roomName => roomName.includes(projectID))
                    )];
    
                    const emitData = {
                        fullDocument: changeData.data,
                        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields })
                    };
    
                    matchingRooms.forEach(room => {
                        data.namespace.to(room).emit(eventName, emitData);
                    });        
                }
            } else {
                const projectID = `${sprintIdentifier}**${data.socketId}`;
                const taskDetailIdentifier = `${taskDetail}**${data.socketId}`
                const subTaskDetailIdentifiew = `${subTaskDetail}**${data.socketId}`;
                const matchingRooms = [...new Set(
                    Array.from(data.namespace.adapter.rooms.keys())
                        .filter((roomName) => {
                            let socId = roomName.split("**");
                            if (socId.length > 1 && socId[1] === data.socketId) {
                                return (
                                    (roomName.includes(projectID) && data.roomName.includes(projectID)) 
                                    ||(data.roomName.includes(taskDetailIdentifier) && roomName.includes(taskDetailIdentifier))
                                    ||(data.roomName.includes(subTaskDetailIdentifiew) && roomName.includes(subTaskDetailIdentifiew))
                                )
                            }
                        })
                )];
                const emitData = {
                    fullDocument: changeData.data,
                    ...(includeUpdatedFields && { updatedFields: changeData.updatedFields })
                };
    
                // SOCKET-PERFORMANCE-PLAN #3: cache the stringified _id once
                // per change instead of deep-cloning the entire task document
                // inside the forEach loop.
                const changedTaskId = String(changeData.data._id);
                matchingRooms.forEach(room => {
                    if (room.includes('taskDetail_')) {
                        let taskId = room.split('**')[0].split('_')[1];
                        if (changedTaskId == taskId) {
                            data.namespace.to(room).emit(`taskDetail_${eventName}`, emitData);
                        } else {
                            data.namespace.to(room).emit(`taskDetail_${eventName}`, {...emitData, isSubTaskUpdate: true});
                        }
                    } else {
                        data.namespace.to(room).emit(`${eventName}`, emitData);
                    }
                });
            }
        });
    }
};

exports.taskSocketHandler = ({socket, namespace}) => {
    socket.on('joinProjectSprintForTask',(data)=>{
        const roomName = `project_sprint_${data.projectId}_${data.sprintId}**${data.socketId}`;
        joinRoom(socket,roomName);
        socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket,isUserIdCheck: data.userId ? true : false, userId: data.userId});
    });
    socket.on('leaveProjectSprintForTask',(roomName)=>{
        let index = socketRef.rooms.findIndex((x)=> x.roomName === roomName);        
        if (index !== -1) {
            socketRef.rooms.splice(index, 1);
        }
        leaveRoom(socket,roomName);
    })
    socket.on('joinTaskDetail',(data)=>{
        const roomName = `taskDetail_${data.taskId}**${data.socketId}`;
        joinRoom(socket,roomName);
        socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket});
    })
    socket.on('leaveTaskDetail',(roomName)=>{
        let index = socketRef.rooms.findIndex((x)=> x.roomName === roomName);        
        if (index !== -1) {
            socketRef.rooms.splice(index, 1);
        }
        leaveRoom(socket,roomName);
    })
}

// SOCKET-PERFORMANCE-PLAN #2: subscribe to module-scoped events only. The
// emitter publishes `task:update` / `task:insert` for any payload tagged
// with `module: 'task'`, so this handler stops firing for comment/company/
// notification mutations.
socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
