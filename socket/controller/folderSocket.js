const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'foldersChanged';

/* Only the fact of a change is sent, to the whole company: which project it was in would tell a member about
   projects they cannot open. Each client reads the folders of the project it has open again through the API. */
const relay = (change) => toCompanyRoom(change && change.companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type }));

['insert', 'update'].forEach((type) => socketEmitter.on(`folders:${type}`, relay));

module.exports = { EVENT, relay };
