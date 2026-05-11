import { io } from 'socket.io-client';
import { tokenStore } from '@/services/tokenStore';

export function socketHelper() {
    function connectServer(serverURL, namespace, query) {
        return new Promise((resolve, reject) => {
            try {
                let socket = io(`${serverURL}/${namespace}`, {
                    query,
                    auth: { token: tokenStore.getAccessToken() }
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