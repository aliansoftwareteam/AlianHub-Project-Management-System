import { io } from 'socket.io-client';

export function socketHelper() {
    function connectServer(serverURL, namespace, query) {
        return new Promise((resolve, reject) => {
            try {
                // The session cookie travels with the handshake; nothing is sent in auth,
                // so a stale token can never win over the cookie the server just set.
                let socket = io(`${serverURL}/${namespace}`, {
                    query,
                    withCredentials: true
                });
                socket.on('connect_error', (error) => {
                    reject(error);
                });
                socket.on('connect', () => {
                    resolve(socket);
                });
            } catch (error) {
                console.error(error);
                reject(error);
            }
        })
    }


    return {
        connectServer
    }
}