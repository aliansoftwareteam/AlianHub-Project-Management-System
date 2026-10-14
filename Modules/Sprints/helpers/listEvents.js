const socketEmitter = require('../../../event/socketEventEmitter');

const COUNT_GATHER_MS = 400;

const named = (row) => ({ _id: String((row && row._id) || '') });

/* Only which row changed is said. socket/controller/listSocket.js reads who may see it from the stored row, and
 * `sharedBefore` (the list's private flag and people before a change to them) lets it tell the people the
 * change took the list from. */
const announceList = (type, companyId, sprint, sharedBefore) => socketEmitter.emit(type, {
    type, companyId: String(companyId), module: 'sprints', data: named(sprint), ...(sharedBefore ? { sharedBefore } : {}),
});

/* A list's task count moves with every task write, so a burst of them (an import, an agent's plan) is said once. */
const countsWaiting = new Map();
const announceListCount = (companyId, sprint) => {
    const id = named(sprint)._id;
    if (!id) return;
    const key = `${companyId}:${id}`;
    if (countsWaiting.has(key)) return;
    const timer = setTimeout(() => {
        countsWaiting.delete(key);
        announceList('update', companyId, sprint);
    }, COUNT_GATHER_MS);
    if (timer.unref) timer.unref();
    countsWaiting.set(key, timer);
};

const announceFolder = (type, companyId, folder) => socketEmitter.emit(type, {
    type, companyId: String(companyId), module: 'folders', data: named(folder),
});

module.exports = { announceList, announceListCount, announceFolder, COUNT_GATHER_MS };
