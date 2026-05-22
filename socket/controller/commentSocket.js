const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

exports.commentSocketHandler = ({ socket, namespace }) => {
    socket.on('joinCommentRoom', (data) => {
        const roomName = data.roomName;
        joinRoom(socket, roomName);
        // SOCKET-PERFORMANCE-PLAN #7 (Phase 2): upsertRoom replaces the
        // hand-rolled findIndex / push-or-replace dedup that used to live
        // inline here. The Map-based index keys on roomName, so re-joining
        // is naturally idempotent.
        upsertRoom({ roomName, socketId: data.socketId, namespace, socket });
    });
    socket.on('leaveCommentRoom', (roomName) => {
        removeRoom(roomName);
        leaveRoom(socket, roomName);
    });
};

function setEventName(type) {
    switch (type) {
        case 'insert': return 'commentInsert';
        case 'update': return 'commentUpdate';
        case 'delete': return 'commentDelete';
        case 'replace': return 'commentReplace';
    }
}

const handleCommentChange = (changeData, includeUpdatedFields = false) => {
    // Both modules share the same emit shape; the only difference is the
    // prefix used to find subscribed rooms.
    let prefix;
    if (changeData.module === 'comments') {
        const { projectId, sprintId, taskId } = changeData.data;
        prefix = `comments_${projectId}_${sprintId}_${taskId}`;
    } else if (changeData.module === 'comments_project') {
        prefix = `comments_project_${changeData.data.projectId}`;
    } else {
        return;
    }

    // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): O(1) prefix lookup replaces the
    // full-array filter + `uniqueRooms` dedup helper. The Map-based index
    // is already deduped by construction (key = roomName), so a second-pass
    // dedup is no longer needed.
    const relatedRooms = findRoomsByPrefix(prefix);
    if (!relatedRooms.length) return;

    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };

    relatedRooms.forEach(data => {
        // SOCKET-PERFORMANCE-PLAN #5 (Phase 2): see taskSocket.js — small-Set
        // membership check beats scanning the namespace's full adapter.rooms.
        if (!data.socket.rooms.has(data.roomName)) return;
        data.namespace.to(data.roomName).emit(eventName, emitData);
    });
};

// SOCKET-PERFORMANCE-PLAN #2: comments are published under two modules —
// `comments` (task-level comments) and `comments_project` (project-level
// comments). Subscribe to both namespaces so the handler still receives
// every relevant event while ignoring task/companies/notification fan-out.
socketEmitter.on('comments:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments:insert', changeData => handleCommentChange(changeData, false));
socketEmitter.on('comments_project:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments_project:insert', changeData => handleCommentChange(changeData, false));
