const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'viewTemplatesChanged';

/* Only the fact of a change is sent; each client reads the list again through the API, which decides what it may see. */
const relay = (change) => toCompanyRoom(change && change.companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type }));

['insert', 'update', 'delete'].forEach((type) => socketEmitter.on(`viewTemplates:${type}`, relay));

module.exports = { EVENT, relay };
