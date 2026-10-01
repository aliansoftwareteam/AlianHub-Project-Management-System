const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'foldersChanged';
const COMPANY_ROOM = 'selected_companies_';

/* Only the fact of a change is sent, to the whole company: which project it was in would tell a member about
   projects they cannot open. Each client reads the folders of the project it has open again through the API. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    if (!companyId) return;
    findRoomsByPrefix(`${COMPANY_ROOM}${companyId}`).forEach((entry) => {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== companyId || !entry.socket.rooms.has(entry.roomName)) return;
        entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type });
    });
};

['insert', 'update'].forEach((type) => socketEmitter.on(`folders:${type}`, relay));

module.exports = { EVENT, relay };
