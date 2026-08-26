const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { commentRoomPrefix } = require('../../Modules/Comments/helpers/commentThread');

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

    /**
     * Relay a typing signal to the other people in a conversation.
     *
     * Deliberately NOT persisted and NOT routed through the change-stream/socketEmitter
     * path the comment events use — this is transient presence, it must not touch the
     * database, and a dropped one is harmless (the receiver expires it on a timer).
     *
     * Addressed to each subscriber's socket directly rather than via
     * `namespace.to(roomName)`: the room name embeds a socket id, so a room can outlive
     * the membership it was registered with, and a missed indicator is not worth
     * inheriting that failure mode.
     */
    socket.on('commentTyping', (data) => {
        if (!data || !data.roomPrefix) return;

        const payload = {
            roomPrefix: data.roomPrefix,
            userId: data.userId,
            typing: !!data.typing,
        };

        findRoomsByPrefix(data.roomPrefix).forEach((entry) => {
            // Never echo to the author — including their own other tabs, which the
            // client also guards against by user id.
            if (!entry.socket || entry.socket === socket || entry.socket.disconnected) return;
            entry.socket.emit('commentTyping', payload);
        });
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
    if (!changeData || !changeData.data) return;
    const thread = commentRoomPrefix(changeData.data);
    const prefix = thread
        ? thread.prefix
        : (changeData.module === 'comments_project'
            ? `comments_project_${changeData.data.projectId}`
            : '');
    if (!prefix) return;

    const relatedRooms = findRoomsByPrefix(prefix);
    if (!relatedRooms.length) return;

    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };

    relatedRooms.forEach((entry) => {
        if (!entry.socket || entry.socket.disconnected) return;
        const rooms = entry.socket.rooms;
        if (rooms && typeof rooms.has === 'function' && !rooms.has(entry.roomName)) return;
        entry.namespace.to(entry.roomName).emit(eventName, emitData);
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

exports.handleCommentChange = handleCommentChange;
