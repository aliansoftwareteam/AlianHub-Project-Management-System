const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, prefixOfOwnRoom, isCompanyMember, readsWholeCompany, toCompanyRoom, COMPANY_ROOM } = require('../roomAccess');
const { COMPANY_MEMBER_FIELDS, memberCompanyView } = require('../../Modules/Company/helpers/companyAccessRules');

exports.companiesSocketHandler = ({ socket, namespace }) => {
    onJoin(socket, 'joinCompaniesRoom',
        (data, identity) => {
            const prefix = prefixOfOwnRoom(socket, data.roomName) || '';
            return prefix.startsWith(COMPANY_ROOM) && isCompanyMember(identity, prefix.slice(COMPANY_ROOM.length));
        },
        (data) => {
            joinRoom(socket, data.roomName);
            upsertRoom({ roomName: data.roomName, socketId: socket.id, namespace, socket });
        });
    socket.on('leaveCompaniesRoom', (roomName) => {
        if (!prefixOfOwnRoom(socket, roomName)) return;
        removeRoom(roomName);
        leaveRoom(socket, roomName);
    });
};

function setEventName(type) {
    switch (type) {
        case 'insert': return 'companiesInsert';
        case 'update': return 'companiesUpdate';
        case 'delete': return 'companiesDelete';
        case 'replace': return 'companiesReplace';
    }
}

const isMemberField = (path) => COMPANY_MEMBER_FIELDS.includes(String(path).split('.')[0]);

const memberFieldsOf = (updatedFields) => Object.fromEntries(Object.entries(updatedFields || {}).filter(([path]) => isMemberField(path)));

/* Each socket is sent what its person reads over HTTP: the row for an owner or admin, its member fields for everyone else. */
const handleCompaniesChange = (changeData, includeUpdatedFields = false) => {
    const company = changeData && changeData.module === 'companies' && changeData.data && changeData.data.data;
    if (!company || !company._id) return undefined;
    const eventName = setEventName(changeData.type);
    const whole = { fullDocument: company, ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }) };
    let limited = null;
    return toCompanyRoom(company._id, async (room) => {
        if (await readsWholeCompany(room.socket.identity)) return room.socket.emit(eventName, whole);
        limited = limited || { fullDocument: memberCompanyView(company), ...(includeUpdatedFields && { updatedFields: memberFieldsOf(changeData.updatedFields) }) };
        return room.socket.emit(eventName, limited);
    });
};

socketEmitter.on('companies:update', changeData => handleCompaniesChange(changeData, true));
socketEmitter.on('companies:insert', changeData => handleCompaniesChange(changeData, false));
