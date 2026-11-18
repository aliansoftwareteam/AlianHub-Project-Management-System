jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const fs = require('fs');
const path = require('path');
const timeouts = require('../Modules/Agents/engine/timeouts');

const fakeReq = (params) => {
    const handlers = {};
    return {
        params,
        setTimeout: jest.fn(),
        socket: { setTimeout: jest.fn() },
        on: jest.fn((event, cb) => { handlers[event] = cb; }),
        close: () => handlers.close && handlers.close(),
    };
};
const fakeRes = () => ({ setHeader: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(), end: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() });

describe('HTTP server timeouts', () => {
    it('sets keep-alive, headers and request timeouts explicitly, with headers above keep-alive', () => {
        const server = timeouts.applyServerTimeouts({});
        expect(server.keepAliveTimeout).toBe(timeouts.SERVER_KEEP_ALIVE_TIMEOUT_MS);
        expect(server.headersTimeout).toBe(timeouts.SERVER_HEADERS_TIMEOUT_MS);
        expect(server.requestTimeout).toBe(timeouts.SERVER_REQUEST_TIMEOUT_MS);
        expect(server.keepAliveTimeout).toBeGreaterThan(60 * 1000);
        expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
        expect(server.requestTimeout).toBeGreaterThan(0);
    });

    it('keeps headersTimeout above keepAliveTimeout even when the env sets them the other way round', () => {
        const env = { ...process.env };
        process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS = '90000';
        process.env.SERVER_HEADERS_TIMEOUT_MS = '10000';
        try {
            jest.isolateModules(() => {
                const t = require('../Modules/Agents/engine/timeouts');
                expect(t.SERVER_KEEP_ALIVE_TIMEOUT_MS).toBe(90000);
                expect(t.SERVER_HEADERS_TIMEOUT_MS).toBeGreaterThan(90000);
            });
        } finally { process.env = env; }
    });

    it('is applied to the server index.js listens on', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        expect(source).toMatch(/applyServerTimeouts\(server\)/);
    });

    it('sets explicit Mongo socket and server-selection timeouts', () => {
        expect(timeouts.mongoTimeoutOptions()).toEqual({
            connectTimeoutMS: timeouts.MONGO_CONNECT_TIMEOUT_MS,
            serverSelectionTimeoutMS: timeouts.MONGO_SERVER_SELECTION_TIMEOUT_MS,
            socketTimeoutMS: timeouts.MONGO_SOCKET_TIMEOUT_MS,
        });
        expect(timeouts.MONGO_SOCKET_TIMEOUT_MS).toBeGreaterThan(0);
        expect(timeouts.MONGO_SERVER_SELECTION_TIMEOUT_MS).toBeGreaterThan(0);
    });
});

describe('SSE streams are exempt from request timeouts', () => {
    const streams = [
        ['AIProjectGenerator/sseEmitter', () => require('../Modules/AIProjectGenerator/sseEmitter').handleEvents, { jobId: 'j1' }],
        ['Company/eventController', () => require('../Modules/Company/eventController').handleEvents, { id: 'e1' }],
        ['AI/eventController', () => require('../Modules/AI/eventController').handleEvents, { id: 'e1' }],
        ['Setup/events', () => require('../Modules/Setup/events').handleEvents, { id: 'e1' }],
    ];

    it.each(streams)('%s disables the socket timeout before streaming', (_name, load, params) => {
        const req = fakeReq(params);
        const res = fakeRes();
        load()(req, res);
        expect(req.setTimeout).toHaveBeenCalledWith(0);
        expect(req.socket.setTimeout).toHaveBeenCalledWith(0);
        req.close();
    });

    it('keepStreamOpen tolerates a request without a socket', () => {
        const req = { setTimeout: jest.fn() };
        expect(() => timeouts.keepStreamOpen(req)).not.toThrow();
        expect(req.setTimeout).toHaveBeenCalledWith(0);
        expect(() => timeouts.keepStreamOpen(undefined)).not.toThrow();
    });
});
