jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => {
    const send = jest.fn();
    const command = (name) => class { constructor(input) { this.name = name; this.input = input; } };
    return {
        __send: send,
        S3Client: class { send(cmd) { return send(cmd); } },
        GetObjectCommand: command('GetObject'),
        CreateBucketCommand: command('CreateBucket'),
        PutObjectCommand: command('PutObject'),
        DeleteObjectCommand: command('DeleteObject'),
        ListObjectsV2Command: command('ListObjectsV2'),
        CopyObjectCommand: command('CopyObject'),
        DeleteBucketCommand: command('DeleteBucket'),
        HeadObjectCommand: command('HeadObject'),
    };
});

const fs = require('fs');
const logger = require('../Config/loggerConfig');
const { __send: s3Send } = require('@aws-sdk/client-s3');
const wasabi = require('../Modules/storage/wasabi/controller');
const serverStorage = require('../Modules/storage/server/helpers/bucket.helper');

const COMPANY = '64b1f0c2a1b2c3d4e5f60718';
const SIGNED = 'https://s3.eu-central-1.wasabisys.com/assets/public_assets/a.png?X-Amz-Credential=AKIAEXAMPLE%2F20260923&X-Amz-Signature=deadbeef';

// Config/logFormat prints only the message; any further argument never reaches the log file.
const loggedLines = () => logger.error.mock.calls.map(([message]) => String(message));
const failureLine = () => loggedLines().find((line) => line.includes('Some uploads failed'));

beforeEach(() => {
    jest.restoreAllMocks();
    logger.error.mockReset();
    s3Send.mockReset();
});

describe('wasabi public asset uploads', () => {
    beforeEach(() => {
        jest.spyOn(fs.promises, 'readFile').mockImplementation(async (file) => {
            if (String(file).endsWith('missing.png')) {
                throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' });
            }
            return Buffer.from('png');
        });
    });

    it('names each failed file with its error code and message in the logged line', async () => {
        s3Send.mockImplementation(async (cmd) => {
            if (cmd.input.Key === 'public_assets/denied.png') {
                throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied', Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
            }
            return {};
        });

        const uploaded = await wasabi.uploadPublicAssetsImagesInWasabi([
            { path: 'denied.png', filePath: '/assets/denied.png' },
            { path: 'missing.png', filePath: '/assets/missing.png' },
            { path: 'fine.png', filePath: '/assets/fine.png' },
        ]);

        expect(uploaded).toEqual(['public_assets/fine.png']);
        const line = failureLine();
        expect(line).toBeDefined();
        expect(line).toContain('denied.png');
        expect(line).toContain('AccessDenied');
        expect(line).toContain('Access Denied');
        expect(line).toContain('missing.png');
        expect(line).toContain('ENOENT');
        expect(line).not.toContain('fine.png');
    });

    it('keeps signed URLs and credentials out of the detail', async () => {
        s3Send.mockRejectedValue(Object.assign(new Error(`Request to ${SIGNED} failed`), { name: 'NetworkingError' }));

        await wasabi.uploadPublicAssetsImagesInWasabi([{ path: 'a.png', filePath: '/assets/a.png' }]);

        const line = failureLine();
        expect(line).toContain('a.png');
        expect(line).toContain('NetworkingError');
        expect(line).not.toMatch(/X-Amz-|AKIAEXAMPLE|deadbeef/);
    });

    it('logs nothing about failures when every upload succeeds', async () => {
        s3Send.mockResolvedValue({});
        await wasabi.uploadPublicAssetsImagesInWasabi([{ path: 'fine.png', filePath: '/assets/fine.png' }]);
        expect(failureLine()).toBeUndefined();
    });
});

describe('server storage seed image copies', () => {
    it('names each failed file with its error code and message in the logged line', async () => {
        jest.spyOn(fs, 'cp').mockImplementation((source, destination, done) => {
            if (String(source).endsWith('bug.png')) {
                done(Object.assign(new Error(`EACCES: permission denied, copyfile '${source}'`), { code: 'EACCES' }));
                return;
            }
            done(null);
        });

        await serverStorage.uploadIamgesInStorage([
            { path: 'setting/task_type/bug.png', filePath: 'bug.png' },
            { path: 'setting/task_type/task.png', filePath: 'task.png' },
        ], COMPANY);

        const line = failureLine();
        expect(line).toBeDefined();
        expect(line).toContain('setting/task_type/bug.png');
        expect(line).toContain('EACCES');
        expect(line).toContain('permission denied');
        expect(line).not.toContain('task.png');
    });
});
