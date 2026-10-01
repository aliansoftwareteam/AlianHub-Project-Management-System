const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'projectTemplatesChanged';
const COMPANY_ROOM = 'selected_companies_';

/* Only the fact of a change is sent; each client reads the list again through the API, which decides what it may see. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    if (!companyId) return;
    findRoomsByPrefix(`${COMPANY_ROOM}${companyId}`).forEach((entry) => {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== companyId || !entry.socket.rooms.has(entry.roomName)) return;
        entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type });
    });
};

['insert', 'update', 'delete'].forEach((type) => socketEmitter.on(`projectSnapshots:${type}`, relay));

module.exports = { EVENT, relay };
