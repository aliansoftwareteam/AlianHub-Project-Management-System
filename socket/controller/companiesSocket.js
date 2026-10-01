const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { onJoin, prefixOfOwnRoom, isCompanyMember, mayReceiveCompany, inOrder } = require('../roomAccess');

const COMPANY_ROOM = 'selected_companies_';

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

const relayCompanyChange = async (company, rooms, eventName, emitData) => {
    for (const room of rooms) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceiveCompany(room.socket.identity, company._id))) continue;
        if (room.socket.rooms.has(room.roomName)) room.namespace.to(room.roomName).emit(eventName, emitData);
    }
};

const handleCompaniesChange = (changeData, includeUpdatedFields = false) => {
    const company = changeData && changeData.module === 'companies' && changeData.data && changeData.data.data;
    if (!company || !company._id) return undefined;
    const rooms = findRoomsByPrefix(`${COMPANY_ROOM}${company._id}`);
    if (!rooms.length) return undefined;
    const emitData = {
        fullDocument: company,
        ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
    };
    return inOrder(() => relayCompanyChange(company, rooms, setEventName(changeData.type), emitData));
};

socketEmitter.on('companies:update', changeData => handleCompaniesChange(changeData, true));
socketEmitter.on('companies:insert', changeData => handleCompaniesChange(changeData, false));
