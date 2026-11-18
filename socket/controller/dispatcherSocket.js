const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'dispatcherChanged';
const MODULES = Object.freeze(['dispatchDecisions', 'dispatcherSettings', 'dispatcherAgents']);

/* Only the kind of change goes out: which task or project would tell a member about work they cannot open. Each client
 * reads the dispatcher again through the API, which decides what it may see. */
const relay = (change) => toCompanyRoom(change && change.companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { kind: change.module }));

MODULES.forEach((module) => socketEmitter.on(`${module}:update`, relay));

module.exports = { EVENT, MODULES, relay };
