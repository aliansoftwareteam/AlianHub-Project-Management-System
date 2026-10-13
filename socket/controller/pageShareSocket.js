const { toCompanyRoom, readablePage } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'docSharesChanged';
const ADDED_EVENT = 'docsChanged';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* Only the fact of a change is sent, and only to the person a doc was shared with or taken from: which doc
   it was is read again through the API, which decides what they may see. */
const relay = (change) => {
    const userId = String((change && change.data && change.data.userId) || '');
    if (!userId) return undefined;
    return toCompanyRoom(change.companyId, (entry) => entry.socket.emit(EVENT, { type: change.type }), (identity) => String(identity.uid) === userId);
};

/* A new doc, made in the web app or by an agent, is told to the people who can open it, and to nobody else. */
const relayAdded = (change) => {
    const pageId = String((change && change.data && change.data._id) || '');
    if (!OBJECT_ID.test(pageId)) return undefined;
    return toCompanyRoom(change.companyId, async (entry) => {
        if (await readablePage(entry.socket.identity, pageId).catch(() => null)) entry.socket.emit(ADDED_EVENT, { type: change.type });
    });
};

socketEmitter.on('pageShares:update', relay);
socketEmitter.on('pages:insert', relayAdded);

module.exports = { EVENT, ADDED_EVENT, relay, relayAdded };
