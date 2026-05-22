const socketRef = require('../socketinit');
const {joinRoom,leaveRoom} = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
exports.companiesSocketHandler = ({socket, namespace}) => {
    socket.on('joinCompaniesRoom',(data)=>{
        const roomName = data.roomName;
        joinRoom(socket,roomName);
        socketRef.rooms.push({roomName, socketId: data.socketId,namespace,socket});
    });
    socket.on('leaveCompaniesRoom',(roomName)=>{
        let index = socketRef.rooms.findIndex((x)=> x.roomName === roomName);        
        if (index !== -1) {
            socketRef.rooms.splice(index, 1);
        }
        leaveRoom(socket,roomName);
    })
}
function setEventName(type) {
    let eventName;
    switch (type) {
        case 'insert': { 
            eventName = 'companiesInsert'
            break;
        }
        case 'update': { 
            eventName = 'companiesUpdate'
            break;
        }
        case 'delete': { 
            eventName = 'companiesDelete'
            break;
        }
        case 'replace': { 
            eventName = 'companiesReplace'
            break;
        }
    }
    return eventName;
}
const handleCompaniesChange = (changeData, includeUpdatedFields = false) => {
    if (changeData.module === 'companies') {
        try {
            // SOCKET-PERFORMANCE-PLAN #3: dropped deep clone — template
            // literal already calls toString() on the ObjectId.
            const companiesIdentifier = `selected_companies_${changeData.data.data._id}`;
            const relatedRooms = socketRef.rooms.filter(x => x.roomName.includes(companiesIdentifier));
            
            relatedRooms.forEach(data => {
                const eventName = setEventName(changeData.type);
                const companies = `${companiesIdentifier}**${data.socketId}`;
                const matchingRooms = [...new Set(
                    Array.from(data.namespace.adapter.rooms.keys())
                        .filter((roomName) => {
                            let socId = roomName.split("**");
                            if (socId.length > 1 && socId[1] === data.socketId) {
                                return (roomName.includes(companies) && data.roomName.includes(companies))
                            }
                        })
                )];
                const emitData = {
                    fullDocument: changeData.data.data,
                    ...(includeUpdatedFields && { updatedFields: changeData.updatedFields })
                };
                matchingRooms.forEach(room => {
                    data.namespace.to(room).emit(`${eventName}`, emitData);
                });
            });
        } catch (error) {
            console.error(error)
        }
    }
};

// SOCKET-PERFORMANCE-PLAN #2: scoped to the `companies` module only.
socketEmitter.on('companies:update', changeData => handleCompaniesChange(changeData, true));
socketEmitter.on('companies:insert', changeData => handleCompaniesChange(changeData, false));