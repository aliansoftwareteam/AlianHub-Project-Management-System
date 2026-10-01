const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'docSharesChanged';

/* Only the fact of a change is sent, and only to the person a doc was shared with or taken from: which doc
   it was is read again through the API, which decides what they may see. */
const relay = (change) => {
    const userId = String((change && change.data && change.data.userId) || '');
    if (!userId) return undefined;
    return toCompanyRoom(change.companyId, (entry) => entry.socket.emit(EVENT, { type: change.type }), (identity) => String(identity.uid) === userId);
};

socketEmitter.on('pageShares:update', relay);

module.exports = { EVENT, relay };
