const socketEmitter = require('../../../event/socketEventEmitter');

const connectionsChanged = (companyId, id, updatedFields = {}) => socketEmitter.emit('update', {
    type: 'update', module: 'integrationConnections', companyId: String(companyId), data: { _id: String(id) }, updatedFields,
});

module.exports = { connectionsChanged };
