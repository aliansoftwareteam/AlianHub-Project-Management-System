const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'customFieldsChanged';
const COMPANY_ROOM = 'selected_companies_';

/* Only the fact of a change is sent, never the field or the projects it is linked to; each client reads the
   definitions again through the API. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    if (!companyId) return;
    findRoomsByPrefix(`${COMPANY_ROOM}${companyId}`).forEach((entry) => {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== companyId || !entry.socket.rooms.has(entry.roomName)) return;
        entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type });
    });
};

['insert', 'update'].forEach((type) => socketEmitter.on(`customFields:${type}`, relay));

module.exports = { EVENT, relay };
