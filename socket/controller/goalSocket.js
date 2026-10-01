const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'goalsChanged';

/* Only the fact of a change is sent, to the whole company: which goal it was would tell a member about goals
   they cannot read. Each client reads its goals again through the API, which decides what it may see. */
const relay = (change) => toCompanyRoom(change && change.companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { type: change.type }));

['insert', 'update'].forEach((type) => socketEmitter.on(`goals:${type}`, relay));

module.exports = { EVENT, relay };
