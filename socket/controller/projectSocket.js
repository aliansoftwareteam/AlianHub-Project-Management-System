const { findRoomsByPrefix } = require('../helper');
const { COMPANY_ROOM, inOrder, mayReceiveCompany, mayReceiveProject, forgetProjectVerdicts } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'projectChanged';
const KINDS = { insert: 'added', update: 'changed' };
const REMOVED = 'removed';
const TRASHED = 1;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const WHO_MAY_OPEN = ['AssigneeUserId', 'isPrivateSpace', 'isPersonal', 'personalOwner'];

const savedFields = (change) => Object.keys(change.updatedFields || {}).map((path) => path.split('.')[0]);

const inTrash = (change) => {
    const saved = change.updatedFields || {};
    const status = Object.prototype.hasOwnProperty.call(saved, 'deletedStatusKey') ? saved.deletedStatusKey : change.data.deletedStatusKey;
    return Number(status) === TRASHED;
};

const kindOf = (change) => (inTrash(change) ? REMOVED : KINDS[change.type]);

const movesWhoMayOpen = (change) => change.type === 'insert' || savedFields(change).some((field) => WHO_MAY_OPEN.includes(field));

/* Only the fact and the project's id are sent, and only to a person the project's read route would answer: a
 * project is never named to someone who cannot open it. Each browser reads it again through that route. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    const projectId = String((change && change.data && change.data._id) || '');
    if (!companyId || !OBJECT_ID.test(projectId)) return undefined;
    const kind = kindOf(change);
    const room = `${COMPANY_ROOM}${companyId}`;
    if (!kind || !findRoomsByPrefix(room).length) return undefined;
    return inOrder(async () => {
        if (movesWhoMayOpen(change)) forgetProjectVerdicts(companyId, projectId);
        const entries = findRoomsByPrefix(room).filter((entry) => entry.socket && entry.socket.identity);
        // Asked together: every other relay waits behind this one, and a person's tabs share one answer.
        const mayReceive = async ({ identity }) => (await mayReceiveCompany(identity, companyId)) && mayReceiveProject(identity, change, projectId);
        const allowed = await Promise.all(entries.map((entry) => mayReceive(entry.socket)));
        entries.forEach((entry, at) => {
            if (allowed[at] && entry.socket.rooms.has(entry.roomName)) entry.socket.emit(EVENT, { kind, companyId, projectId });
        });
    });
};

['insert', 'update'].forEach((type) => socketEmitter.on(`project:${type}`, relay));

module.exports = { EVENT, relay };
