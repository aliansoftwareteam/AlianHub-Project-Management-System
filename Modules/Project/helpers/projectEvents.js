const socketEmitter = require('../../../event/socketEventEmitter');

/* socket/controller/projectSocket.js passes the fact on, to the people who may open the project. */
const announceProject = (companyId, type, project, updatedFields = {}) => socketEmitter.emit(type, {
    type, companyId: String(companyId), data: project, updatedFields, module: 'project',
});

module.exports = { announceProject };
