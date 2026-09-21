const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefixes,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, roomFor, prefixOfOwnRoom, isSelf, canOpenTask, canOpenSprintBoard } = require('../roomAccess');

function setEventName(type) {
    switch (type) {
        case 'insert': return 'taskInsert';
        case 'update': return 'taskUpdate';
        case 'delete': return 'taskDelete';
        case 'replace': return 'taskReplace';
    }
}

const handleTaskChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module !== 'task') return;

    // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): O(1) prefix lookup. Three
    // prefixes are checked because a task event needs to broadcast to:
    //   - everyone watching the sprint board (`project_sprint_<pid>_<sid>`)
    //   - everyone viewing the task detail panel (`taskDetail_<tid>`)
    //   - everyone viewing the parent task detail panel
    //     (`taskDetail_<parentTaskId>`) so subtask updates are visible
    // findRoomsByPrefixes dedups across all three prefixes in one pass.
    const sprintIdentifier = `project_sprint_${changeData.data.ProjectID}_${changeData.data.sprintId}`;
    const taskDetail = `taskDetail_${changeData.data._id}`;
    const subTaskDetail = `taskDetail_${changeData.data.ParentTaskId}`;
    const relatedRooms = findRoomsByPrefixes(sprintIdentifier, taskDetail, subTaskDetail);
    if (!relatedRooms.length) return;

    const eventName = setEventName(changeData.type);
    const changedTaskId = String(changeData.data._id);

    relatedRooms.forEach(data => {
        // SOCKET-PERFORMANCE-PLAN #5 (Phase 2): cheap O(1) liveness guard.
        // Replaces the previous `Array.from(adapter.rooms.keys()).filter(...)`
        // scan that iterated every room in the namespace per matching entry.
        // socket.rooms is a small Set (3–5 rooms per socket); has() is O(1).
        if (!data.socket.rooms.has(data.roomName)) return;

        if (data.isUserIdCheck) {
            const userId = data.namespace.name.split('_').pop();
            if (!changeData.data.AssigneeUserId.includes(userId)) return;

            const emitData = {
                fullDocument: changeData.data,
                ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
            };
            data.namespace.to(data.roomName).emit(eventName, emitData);
            return;
        }

        const emitData = {
            fullDocument: changeData.data,
            ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
        };

        if (data.roomName.includes('taskDetail_')) {
            // Detail-pane rooms get a distinct event name and an
            // `isSubTaskUpdate` flag when the change is for a subtask of
            // the task this detail pane is showing.
            const taskId = data.roomName.split('**')[0].split('_')[1];
            if (changedTaskId == taskId) {
                data.namespace.to(data.roomName).emit(`taskDetail_${eventName}`, emitData);
            } else {
                data.namespace.to(data.roomName).emit(`taskDetail_${eventName}`, { ...emitData, isSubTaskUpdate: true });
            }
        } else {
            data.namespace.to(data.roomName).emit(eventName, emitData);
        }
    });
};

const leaveOwnRoom = (socket, roomName) => {
    if (!prefixOfOwnRoom(socket, roomName)) return;
    removeRoom(roomName);
    leaveRoom(socket, roomName);
};

exports.taskSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinProjectSprintForTask',
        (data, identity) => (!data.userId || isSelf(identity, data.userId)) && canOpenSprintBoard(identity, data.projectId, data.sprintId),
        (data) => {
            const roomName = roomFor(socket, `project_sprint_${data.projectId}_${data.sprintId}`);
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
    socket.on('leaveProjectSprintForTask', (roomName) => leaveOwnRoom(socket, roomName));
    onJoin(socket, 'joinTaskDetail',
        (data, identity) => canOpenTask(identity, data.taskId),
        (data) => {
            const roomName = roomFor(socket, `taskDetail_${data.taskId}`);
            joinRoom(socket, roomName);
            upsertRoom({ roomName, socketId: socket.id, namespace, socket });
        });
    socket.on('leaveTaskDetail', (roomName) => leaveOwnRoom(socket, roomName));
};

// SOCKET-PERFORMANCE-PLAN #2: subscribe to module-scoped events only. The
// emitter publishes `task:update` / `task:insert` for any payload tagged
// with `module: 'task'`, so this handler stops firing for comment/company/
// notification mutations.
socketEmitter.on('task:update', changeData => handleTaskChange(changeData, true));
socketEmitter.on('task:insert', changeData => handleTaskChange(changeData, false));
