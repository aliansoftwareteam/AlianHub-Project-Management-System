const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'whiteboardChanged';

/* The list's own room is joined through canOpenSprintBoard, so only people who may open the list hear of it.
   Only the board's id and revision are sent; each client reads the board again through the API. */
const relay = (change) => {
    const { companyId, projectId, sprintId, boardId, revision } = change || {};
    if (!companyId || !projectId || !sprintId) return;
    findRoomsByPrefix(`project_sprint_${projectId}_${sprintId}`).forEach((entry) => {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== String(companyId) || !entry.socket.rooms.has(entry.roomName)) return;
        entry.namespace.to(entry.roomName).emit(EVENT, { boardId, revision });
    });
};

socketEmitter.on('whiteboards:update', relay);

module.exports = { EVENT, relay };
