jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const lastSeen = require('../Config/lastSeen');

const UID = '6f0000000000000000000a01';

describe('lastSeenAt', () => {
    const writes = [];
    beforeEach(() => {
        writes.length = 0;
        lastSeen._useWriterForTests(async (uid, at) => { writes.push([uid, at.getTime()]); });
    });

    it('is written at most once an hour per person', async () => {
        const now = Date.parse('2026-11-02T10:00:00Z');
        expect(lastSeen.noteSeen(UID, now)).toBe(true);
        expect(lastSeen.noteSeen(UID, now + lastSeen.WRITE_EVERY_MS - 1)).toBe(false);
        expect(lastSeen.noteSeen(UID, now + lastSeen.WRITE_EVERY_MS)).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(writes).toEqual([[UID, now], [UID, now + lastSeen.WRITE_EVERY_MS]]);
    });

    it('ignores what is not a user id, and tries again after a failed write', async () => {
        expect(lastSeen.noteSeen('agent-1')).toBe(false);
        lastSeen._useWriterForTests(async () => { throw new Error('down'); });
        expect(lastSeen.noteSeen(UID, 1000)).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(lastSeen.noteSeen(UID, 2000)).toBe(true);
    });
});
