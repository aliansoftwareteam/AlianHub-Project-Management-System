const mockDb = { rows: [], pulls: [] };

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/aws.js', () => ({ region: 'test', wasabiEndPoint: 'https://s3.example', wasabiAccessKey: 'k', wasabiSecretAccessKey: 's' }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (db, { type, data }, method) => {
        if (type === 'timesheets' && method === 'find') return data[0]._id ? [] : mockDb.rows;
        if (type === 'timesheets' && method === 'updateOne') mockDb.pulls.push(data);
        return null;
    }),
}));
jest.mock('@aws-sdk/client-s3', () => {
    const send = jest.fn(async () => ({}));
    return {
        __send: send,
        S3Client: class { send(command) { return send(command); } },
        DeleteObjectCommand: class { constructor(input) { this.input = input; } },
    };
});

const { __send: s3Send } = require('@aws-sdk/client-s3');
const logger = require('../Config/loggerConfig');
const { runRetentionForCompany } = require('../Modules/ScreenshotRetention/helper');

const COMPANY = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000e01';
const TIMER = '6f0000000000000000000d01';
const OTHER_TIMER = '6f0000000000000000000d02';
const TASK = '6f0000000000000000000b01';
const LONG_AGO = Date.now() - 400 * 24 * 60 * 60 * 1000;

const capture = (timerId, name) => `Project/${PROJECT}/Sprint/${SPRINT}/TimeLog/${timerId}/${name}`;
const shot = (image) => ({ image, screenShotTime: String(LONG_AGO) });
const removedKeys = () => s3Send.mock.calls.map(([command]) => command.input.Key);
const run = () => runRetentionForCompany({ _id: COMPANY, screenshotRetention: { enabled: true, maxAgeMonths: 3 } });

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.rows = [];
    mockDb.pulls = [];
});

describe('screenshot retention', () => {
    it('removes an old capture stored in its own timer\'s folder, with its thumbnails', async () => {
        const own = capture(TIMER, '20240101T000000000Z_1700000000.png');
        mockDb.rows = [{ _id: TIMER, trackShots: [shot(own)] }];
        const stats = await run();

        expect(stats.deletedCount).toBe(1);
        expect(removedKeys()).toHaveLength(5);
        expect(removedKeys()[0]).toBe(own);
        expect(removedKeys().every((key) => key.startsWith(capture(TIMER, '')))).toBe(true);
        expect(mockDb.pulls[0][1]).toEqual({ $pull: { trackShots: { image: { $in: [own] } } } });
    });

    it('takes a capture recorded as a full address in the same folder', async () => {
        const own = capture(TIMER, '1700000001.png');
        mockDb.rows = [{ _id: TIMER, trackShots: [shot(`https://s3.example/${COMPANY}/${own}`)] }];
        await run();

        expect(removedKeys()[0]).toBe(own);
    });

    it.each([
        ['the folder of another timer', capture(OTHER_TIMER, '1700000002.png')],
        ['a task attachment folder', `Project/${PROJECT}/Sprint/${TASK}/Attachment/spec.png`],
        ['a comment folder', `Project/${PROJECT}/${SPRINT}/${TASK}/Comments/photo.png`],
        ['no layout at all', 'backups/company.zip'],
    ])('keeps a file a row names in %s, and the row keeps the entry', async (_label, key) => {
        mockDb.rows = [{ _id: TIMER, trackShots: [shot(key)] }];
        const stats = await run();

        expect(removedKeys()).toEqual([]);
        expect(mockDb.pulls).toEqual([]);
        expect(stats).toMatchObject({ deletedCount: 0, skippedCount: 1 });
        expect(logger.warn.mock.calls.map(([line]) => line).join('\n')).not.toContain(key);
    });
});
