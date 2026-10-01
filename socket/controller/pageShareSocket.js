const { findRoomsByPrefix } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'docSharesChanged';
const COMPANY_ROOM = 'selected_companies_';

/* Only the fact of a change is sent, and only to the person a doc was shared with or taken from: which doc
   it was is read again through the API, which decides what they may see. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    const userId = String((change && change.data && change.data.userId) || '');
    if (!companyId || !userId) return;
    findRoomsByPrefix(`${COMPANY_ROOM}${companyId}`).forEach((entry) => {
        const identity = entry.socket && entry.socket.identity;
        if (!identity || identity.companyId !== companyId || String(identity.uid) !== userId || !entry.socket.rooms.has(entry.roomName)) return;
        entry.socket.emit(EVENT, { type: change.type });
    });
};

socketEmitter.on('pageShares:update', relay);

module.exports = { EVENT, relay };
