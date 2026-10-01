const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'customFieldsChanged';

/* Only the fact of a change is sent, never the field or the projects it is linked to; each client reads the
   definitions again through the API. */
const relay = (change) => toCompanyRoom(change && change.companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type }));

['insert', 'update'].forEach((type) => socketEmitter.on(`customFields:${type}`, relay));

module.exports = { EVENT, relay };
