const socketEmitter = require('../../../event/socketEventEmitter');

const named = (row) => ({ _id: String((row && row._id) || '') });

/* Only which row changed is said. socket/controller/listSocket.js reads who may see it from the stored row, and
 * `sharedBefore` (the list's private flag and people before a change to them) lets it tell the people the
 * change took the list from. */
const announceList = (type, companyId, sprint, sharedBefore) => socketEmitter.emit(type, {
    type, companyId: String(companyId), module: 'sprints', data: named(sprint), ...(sharedBefore ? { sharedBefore } : {}),
});

const announceFolder = (type, companyId, folder) => socketEmitter.emit(type, {
    type, companyId: String(companyId), module: 'folders', data: named(folder),
});

module.exports = { announceList, announceFolder };
