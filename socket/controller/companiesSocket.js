const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');

exports.companiesSocketHandler = ({ socket, namespace }) => {
    socket.on('joinCompaniesRoom', (data) => {
        const roomName = data.roomName;
        joinRoom(socket, roomName);
        upsertRoom({ roomName, socketId: data.socketId, namespace, socket });
    });
    socket.on('leaveCompaniesRoom', (roomName) => {
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
    if (changeData.module !== 'companies') return;

    try {
        const companiesIdentifier = `selected_companies_${changeData.data.data._id}`;
        // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): O(1) prefix lookup.
        const relatedRooms = findRoomsByPrefix(companiesIdentifier);
        if (!relatedRooms.length) return;

        const eventName = setEventName(changeData.type);
        const emitData = {
            fullDocument: changeData.data.data,
            ...(includeUpdatedFields && { updatedFields: changeData.updatedFields }),
        };

        relatedRooms.forEach(data => {
            if (!data.socket.rooms.has(data.roomName)) return;
            data.namespace.to(data.roomName).emit(eventName, emitData);
        });
    } catch (error) {
        console.error(error);
    }
};

// SOCKET-PERFORMANCE-PLAN #2: scoped to the `companies` module only.
socketEmitter.on('companies:update', changeData => handleCompaniesChange(changeData, true));
socketEmitter.on('companies:insert', changeData => handleCompaniesChange(changeData, false));
