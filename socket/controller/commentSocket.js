const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { onJoin, roomFor, prefixOfOwnRoom, canOpenComments, pageCommentRoomOf, readablePage, mayReceiveComments, forTheViewer, inOrder } = require('../roomAccess');
const { THREAD_MODULE } = require('../../Modules/Comments/helpers/chatThreads');

exports.commentSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinCommentRoom',
        (data, identity) => {
            const prefix = prefixOfOwnRoom(socket, data.roomName);
            return Boolean(prefix) && canOpenComments(identity, prefix);
        },
        (data) => {
            joinRoom(socket, data.roomName);
            upsertRoom({ roomName: data.roomName, socketId: socket.id, namespace, socket });
        });
    socket.on('leaveCommentRoom', (roomName) => {
        if (!prefixOfOwnRoom(socket, roomName)) return;
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
        const { identity } = socket;
        if (!identity || !data || typeof data.roomPrefix !== 'string' || !data.roomPrefix || !socket.rooms.has(roomFor(socket, data.roomPrefix))) return;

        const payload = {
            roomPrefix: data.roomPrefix,
            userId: identity.uid,
            typing: !!data.typing,
        };

        // The author's other tabs are in the room too; the client drops those by user id.
        const others = findRoomsByPrefix(data.roomPrefix).filter((entry) => entry.socket && entry.socket !== socket);
        if (!others.length) return;
        inOrder(async () => {
            // The sender's room outlives their access too, so they are asked the same question as each receiver.
            if (!(await mayReceiveComments(identity, identity, data.roomPrefix))) return;
            for (const entry of others) {
                // eslint-disable-next-line no-await-in-loop
                if (!(await mayReceiveComments(entry.socket.identity, identity, data.roomPrefix))) continue;
                if (!entry.socket.disconnected && entry.socket.rooms.has(entry.roomName)) entry.socket.emit('commentTyping', payload);
            }
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

const prefixOf = ({ module, data }) => {
    if (module === 'comments' || module === THREAD_MODULE) return `comments_${data.projectId}_${data.sprintId}_${data.taskId}`;
    if (module === 'comments_project') return `comments_project_${data.projectId}`;
    return null;
};

const relayCommentChange = async (changeData, prefix, includeUpdatedFields) => {
    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: changeData.data,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };
    for (const room of findRoomsByPrefix(prefix)) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceiveComments(room.socket.identity, changeData, prefix))) continue;
        if (room.socket.rooms.has(room.roomName)) room.namespace.to(room.roomName).emit(eventName, emitData);
    }
};

const handleCommentChange = (changeData, includeUpdatedFields = false) => {
    const prefix = changeData && changeData.data ? prefixOf(changeData) : null;
    if (!prefix || !findRoomsByPrefix(prefix).length) return undefined;
    return inOrder(() => relayCommentChange(changeData, prefix, includeUpdatedFields));
};

const PAGE_COMMENT_EVENTS = { insert: 'pageCommentInsert', update: 'pageCommentUpdate' };

/* Sent to each room member only while they can still read the doc: a doc made private keeps its old viewers
 * in the room until they leave it, and they must not see what is said after. */
exports.relayPageComment = async (changeData) => {
    const comment = (changeData && changeData.data) || {};
    const eventName = PAGE_COMMENT_EVENTS[changeData && changeData.type];
    if (!eventName || !comment.pageId) return;
    const rooms = findRoomsByPrefix(pageCommentRoomOf(comment.pageId));
    if (!rooms.length) return;
    const companyId = String(changeData.companyId || '');
    const decisions = new Map();
    for (const entry of rooms) {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== companyId || !entry.socket.rooms.has(entry.roomName)) continue;
        if (!decisions.has(identity.uid)) {
            // eslint-disable-next-line no-await-in-loop
            decisions.set(identity.uid, Boolean(await forTheViewer(() => readablePage(identity, comment.pageId)).catch(() => null)));
        }
        if (decisions.get(identity.uid)) entry.namespace.to(entry.roomName).emit(eventName, { fullDocument: comment });
    }
};

const relayOrLog = (changeData) => exports.relayPageComment(changeData)
    .catch((error) => logger.error(`Page comment relay failed: ${error.message || error}`));
socketEmitter.on('pageComments:insert', relayOrLog);
socketEmitter.on('pageComments:update', relayOrLog);
socketEmitter.on('comments:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments:insert', changeData => handleCommentChange(changeData, false));
socketEmitter.on(`${THREAD_MODULE}:update`, changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments_project:update', changeData => handleCommentChange(changeData, true));
socketEmitter.on('comments_project:insert', changeData => handleCommentChange(changeData, false));
