process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ storedFileExists: jest.fn(async () => false) }));

const { TIMER_NOT_RUNNING: SERVER_CODE } = require('../Modules/LogTime/controllerV2/sessionUser');
const { TIMER_NOT_RUNNING, timerStoppedElsewhere } = require('../time-tracker-app/renderer/utils/captureRefusal');

const refusal = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

describe('when the desktop tracker ends its session after a refused capture', () => {
    it('reads the same code the server sends', () => {
        expect(SERVER_CODE).toBe('timer_not_running');
        expect(TIMER_NOT_RUNNING).toBe(SERVER_CODE);
    });

    it('ends it when the server says the timer is no longer running', () => {
        expect(timerStoppedElsewhere(refusal(403, { status: false, statusText: 'This timer is no longer running.', code: SERVER_CODE }))).toBe(true);
    });

    it.each([
        ['a lost connection', Object.assign(new Error('Network Error'), { request: {} })],
        ['a request that timed out', Object.assign(new Error('timeout of 0ms exceeded'), { code: 'ECONNABORTED' })],
        ['a server fault', refusal(500, { status: false, statusText: 'boom' })],
        ['a server fault that carries the code', refusal(502, { code: SERVER_CODE })],
        ['a capture name that is already taken', refusal(409, { status: false, code: 'capture_already_stored' })],
        ['a capture sent to another folder', refusal(403, { status: false, statusText: 'A capture is stored in the folder of the timer it belongs to.' })],
        ['someone else\'s timer', refusal(403, { status: false, statusText: 'You can only track your own time.' })],
        ['the same words without the code', refusal(403, { status: false, statusText: 'This timer is no longer running.' })],
        ['a sign-in that expired', refusal(401, { isJwtError: true })],
        ['an answer with no body', refusal(403, undefined)],
        ['a queued request', undefined],
        ['an error with no response', new TypeError("Cannot read properties of undefined (reading 'status')")],
    ])('keeps it running after %s', (_label, error) => {
        expect(timerStoppedElsewhere(error)).toBe(false);
    });
});
