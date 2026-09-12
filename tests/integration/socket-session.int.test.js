const { io } = require('socket.io-client');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

const ACK_WAIT_MS = 2000;

const connect = ({ accessToken, companyId, userId }) => new Promise((resolve, reject) => {
    const socket = io(`${state.baseURL}/userid_${companyId}_${userId}`, {
        transports: ['websocket'],
        auth: { token: accessToken },
        query: { userRole: 3 },
        reconnection: false,
        timeout: 10000,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
    });
});

/* `getRoomList` answers through a callback, so an ack proves the socket is still being
 * served; no ack within the window means the server is no longer talking to it. */
const askForRooms = (socket) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ACK_WAIT_MS);
    socket.emit('getRoomList', socket.id, (rooms) => {
        clearTimeout(timer);
        resolve(rooms);
    });
});

const logout = (session) => createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId })
    .post('/api/v2/logout', { id: session.userId });

describe('socket sessions', () => {
    const open = [];
    afterEach(() => {
        open.splice(0).forEach((socket) => socket.close());
    });

    const openSocket = async (session) => {
        const socket = await connect({ accessToken: session.accessToken, companyId: state.companyId, userId: session.userId });
        open.push(socket);
        return socket;
    };

    it('serves a socket opened with a live session', async () => {
        const member = await loginAs('member');
        const socket = await openSocket(member);
        expect(await askForRooms(socket)).not.toBeNull();
    });

    it('stops serving an open socket once its session is logged out', async () => {
        const member = await loginAs('member');
        const socket = await openSocket(member);
        expect(await askForRooms(socket)).not.toBeNull();

        expect((await logout(member)).status).toBe(200);

        expect(await askForRooms(socket)).toBeNull();
        expect(socket.connected).toBe(false);
    });

    it('refuses a handshake carrying a logged-out access token', async () => {
        const member = await loginAs('member');
        expect((await logout(member)).status).toBe(200);

        await expect(connect({ accessToken: member.accessToken, companyId: state.companyId, userId: member.userId }))
            .rejects.toThrow(/Authentication error/);
    });

    it('refuses a handshake with no token at all', async () => {
        const member = await loginAs('member');
        await expect(connect({ accessToken: '', companyId: state.companyId, userId: member.userId }))
            .rejects.toThrow(/Authentication error/);
    });
});
