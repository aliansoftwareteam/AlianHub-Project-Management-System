const { Server } = require('socket.io');
const {taskSocketHandler} = require('./controller/taskSocket');
const {chatSocketHandler} = require('./controller/chatSocket');
const {commentSocketHandler} = require('./controller/commentSocket');
const {companiesSocketHandler} = require('./controller/companiesSocket');
const {userNotificationCountHandler} = require('./controller/userNotificationCount');
const { instrument } = require('@socket.io/admin-ui');
const jwt = require('jsonwebtoken');
const { corsOriginDelegate } = require('../utils/cors.js');
exports.changeStreams = [];
const EventEmitter = require('events');
exports.emitter = new EventEmitter();
exports.rooms = [];

exports.initSocket = (server) => {

    let io = new Server(server, {
        // CORS — BUG-003 / #57. Replace `origin: '*'` (which combined with
        // `credentials: true` let any origin open an authenticated websocket
        // as the logged-in user) with the same env-driven allow-list used by
        // the Express HTTP layer (see utils/cors.js).
        cors: {
            origin: corsOriginDelegate,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });
    const userNamespace = io.of(/^\/userid_\w+$/);
    userNamespace.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return next(new Error('Authentication error: Invalid token'));
            }
            socket.user = decoded;
            next();
        });
    });
    instrument(io, {
        auth: {
            type: "basic",
            username: "alian",
            password: "$2a$12$HHemhzmTrC8Dmf2Gd9v/Teo9oiCxfYJb.St3HKMBx1L3wJmZLeX5u"
        }, 
        namespaceName: '/admin', 
        mode: "development"
    });

    userNamespace.on('connection', (socket) => {
        const {userRole} = socket.handshake.query;
        socket.customData = {userRole};
        const namespace = socket.nsp;
        socket.on('disconnectNameSpace', (id) => {
            let roomsArray = [];
            socket.adapter.rooms.forEach((_, roomName) => {
                roomsArray.push(roomName);
            })
            let count = 0
            let countFunction = (roomName) => {
                if (count >= roomsArray.length) {
                    namespace.sockets.get(id)?.disconnect(true);
                    return;
                } else {
                    let index = exports.rooms.findIndex((x)=> (x.roomName === roomName && x.roomName.includes(id)));
                    if (index !== -1){
                        exports.rooms.splice(index, 1);
                        count++;
                        countFunction(roomsArray[count]);
                    } else {
                        count++;
                        countFunction(roomsArray[count]);
                    }
                }
            }
            countFunction(roomsArray[count]);
        });

        socket.on('getRoomList', (socketId, callback) => {
            let roomsArray = [];
            socket.adapter.rooms.forEach((_, roomName) => {
                if (roomName.includes("**") && roomName.includes(socketId)) {
                    roomsArray.push(roomName)
                }
            })
            callback(roomsArray);
        });
        taskSocketHandler({socket, namespace});
        chatSocketHandler({socket, namespace});
        userNotificationCountHandler({socket, namespace});
        commentSocketHandler({socket, namespace});
        companiesSocketHandler({socket, namespace});
    });
    
};

