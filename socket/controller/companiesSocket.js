const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, prefixOfOwnRoom, isCompanyMember, toCompanyRoom, COMPANY_ROOM } = require('../roomAccess');

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

const handleCompaniesChange = (changeData, includeUpdatedFields = false) => {
    const company = changeData && changeData.module === 'companies' && changeData.data && changeData.data.data;
    if (!company || !company._id) return undefined;
    const eventName = setEventName(changeData.type);
    const emitData = {
        fullDocument: company,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };
    return toCompanyRoom(company._id, (room) => room.namespace.to(room.roomName).emit(eventName, emitData));
};

socketEmitter.on('companies:update', changeData => handleCompaniesChange(changeData, true));
socketEmitter.on('companies:insert', changeData => handleCompaniesChange(changeData, false));
