jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const hostingMode = require('../Config/hostingMode');
const lastSeen = require('../Config/lastSeen');

const UID = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000a02';
const NOW = Date.parse('2026-11-02T10:00:00Z');
const savedMode = process.env.HOSTING_MODE;

const inMode = (mode) => {
    process.env.HOSTING_MODE = mode;
    hostingMode._resetForTests();
};

describe('lastSeenAt', () => {
    const writes = [];
    beforeEach(() => {
        inMode('managed');
        writes.length = 0;
        lastSeen._useWriterForTests(async (seen) => { writes.push(seen); });
    });
    afterAll(() => {
        if (savedMode === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = savedMode;
        hostingMode._resetForTests();
        lastSeen._useWriterForTests(async () => {});
    });

    it('is only noted by a request, and written by the next flush in one bulk write', async () => {
        expect(lastSeen.noteSeen(UID, NOW)).toBe(true);
        expect(lastSeen.noteSeen(OTHER, NOW + 5)).toBe(true);
        expect(lastSeen.noteSeen(UID, NOW + 10)).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(writes).toEqual([]);
        expect(await lastSeen.flushSeen()).toBe(2);
        expect(writes).toEqual([[[UID, NOW + 10], [OTHER, NOW + 5]]]);
        expect(await lastSeen.flushSeen()).toBe(0);
    });

    it('is written at most once an hour per person', async () => {
        lastSeen.noteSeen(UID, NOW);
        await lastSeen.flushSeen();
        expect(lastSeen.noteSeen(UID, NOW + lastSeen.WRITE_EVERY_MS - 1)).toBe(false);
        expect(lastSeen.noteSeen(UID, NOW + lastSeen.WRITE_EVERY_MS)).toBe(true);
        await lastSeen.flushSeen();
        expect(writes).toEqual([[[UID, NOW]], [[UID, NOW + lastSeen.WRITE_EVERY_MS]]]);
    });

    it('keeps what a failed flush could not write for the next one', async () => {
        lastSeen._useWriterForTests(async () => { throw new Error('down'); });
        lastSeen.noteSeen(UID, NOW);
        expect(await lastSeen.flushSeen()).toBe(0);
        lastSeen._useWriterForTests(async (seen) => { writes.push(seen); });
        lastSeen.noteSeen(UID, NOW);
        expect(await lastSeen.flushSeen()).toBe(1);
    });

    it('notes nothing self-hosted, or for what is not a user id', () => {
        expect(lastSeen.noteSeen('agent-1', NOW)).toBe(false);
        inMode('self');
        expect(lastSeen.noteSeen(UID, NOW)).toBe(false);
    });
});
