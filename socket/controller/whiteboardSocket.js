const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { mayReceiveList, inOrder } = require('../roomAccess');

const EVENT = 'whiteboardChanged';

/* Only the board's id and revision are sent, to the people who may still open the list; each client reads the
   board again through the API. */
const send = async (change, rooms) => {
    for (const entry of rooms) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceiveList(entry.socket && entry.socket.identity, change))) continue;
        if (entry.socket.rooms.has(entry.roomName)) entry.namespace.to(entry.roomName).emit(EVENT, { boardId: change.boardId, revision: change.revision });
    }
};

const relay = (change) => {
    const { companyId, projectId, sprintId } = change || {};
    if (!companyId || !projectId || !sprintId) return undefined;
    const rooms = findRoomsByPrefix(`project_sprint_${projectId}_${sprintId}`);
    return rooms.length ? inOrder(() => send(change, rooms)) : undefined;
};

socketEmitter.on('whiteboards:update', relay);

module.exports = { EVENT, relay };
