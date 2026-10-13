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
const path = require('path');
const { __send: s3Send } = require('@aws-sdk/client-s3');
const { updateCompanyFun, getCompanyDataFun } = require('../Modules/Company/controller/updateCompany');

const COMPANY = '64b1f0c2a1b2c3d4e5f60718';
const MB = 1024 * 1024;
const bucketSizeUpdate = (size) => [
    'global',
    { type: 'companies', data: [{ _id: expect.anything() }, { $set: { bucketSize: size } }] },
    'findOneAndUpdate',
    COMPANY,
];
const outcome = (promise, waitMs = 1000) => Promise.race([
    Promise.resolve(promise).then(() => 'fulfilled', () => 'rejected'),
    new Promise((resolve) => { setTimeout(resolve, waitMs, 'pending'); }),
]);

beforeEach(() => {
    jest.restoreAllMocks();
    updateCompanyFun.mockReset();
    updateCompanyFun.mockResolvedValue({ _id: COMPANY });
    getCompanyDataFun.mockReset();
    getCompanyDataFun.mockResolvedValue([{ _id: COMPANY }]);
    s3Send.mockReset();
});

describe('bucket size cron on server storage', () => {
    const bucketDir = path.resolve(__dirname, '..', 'storage', COMPANY);
    const fakeDisk = {
        [bucketDir]: ['a.png', 'nested'],
        [path.join(bucketDir, 'nested')]: ['b.pdf'],
    };

    beforeEach(() => {
        const { existsSync, readdirSync, statSync } = fs;
        jest.spyOn(fs, 'existsSync').mockImplementation((p) => (String(p).startsWith(bucketDir) ? true : existsSync(p)));
        jest.spyOn(fs, 'readdirSync').mockImplementation((p, ...rest) => (fakeDisk[p] ? fakeDisk[p] : readdirSync(p, ...rest)));
        jest.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
            if (!String(p).startsWith(bucketDir)) return statSync(p, ...rest);
            return fakeDisk[p] ? { isDirectory: () => true, size: 0 } : { isDirectory: () => false, size: MB };
        });
    });

    it('settles the cron handler only after every company\'s size is stored, each without error', async () => {
        const helper = require('../Modules/storage/server/helpers/bucket.helper');
        const perCompany = jest.spyOn(helper, 'getBucketSizeCompanyWiseStorage');
        let finishUpdate;
        updateCompanyFun.mockReturnValue(new Promise((resolve) => { finishUpdate = resolve; }));
        const { handleBucketSizeUpdateCron } = require('../common-storage/common-server');

        const run = handleBucketSizeUpdateCron();
        expect(await outcome(run, 50)).toBe('pending');
        finishUpdate({ _id: COMPANY });
        expect(await outcome(run)).toBe('fulfilled');

        expect(getCompanyDataFun).toHaveBeenCalledWith([], true);
        expect(updateCompanyFun).toHaveBeenCalledWith(...bucketSizeUpdate('2'));
        const perCompanyOutcomes = await Promise.all(perCompany.mock.results.map((result) => outcome(result.value)));
        expect(perCompanyOutcomes).toEqual(['fulfilled']);
    });

    it('rejects when the company list cannot be read', async () => {
        getCompanyDataFun.mockRejectedValue(new Error('mongo down'));
        const { handleBucketSizeUpdateCron } = require('../common-storage/common-server');
        expect(await outcome(handleBucketSizeUpdateCron())).toBe('rejected');
    });

    it('resolves the measured size after updating the company', async () => {
        const { getBucketSizeCompanyWiseStorage } = require('../Modules/storage/server/helpers/bucket.helper');
        await expect(getBucketSizeCompanyWiseStorage(COMPANY, 'MB', true)).resolves.toMatchObject({ unit: 'MB' });
        expect(updateCompanyFun).toHaveBeenCalledTimes(1);
    });

    it('still resolves when the company update fails', async () => {
        updateCompanyFun.mockRejectedValue(new Error('mongo down'));
        const { getBucketSizeCompanyWiseStorage } = require('../Modules/storage/server/helpers/bucket.helper');
        await expect(getBucketSizeCompanyWiseStorage(COMPANY, 'MB', true)).resolves.toMatchObject({ unit: 'MB' });
    });
});

describe('bucket size cron on Wasabi storage', () => {
    it('lists the bucket through the storage client and stores its size', async () => {
        s3Send.mockResolvedValue({ Contents: [{ Size: MB }, { Size: 3 * MB }] });
        const { handleBucketSizeUpdateCron } = require('../common-storage/common-wasabi');
        await handleBucketSizeUpdateCron();
        expect(s3Send).toHaveBeenCalledWith(expect.objectContaining({ name: 'ListObjectsV2', input: expect.objectContaining({ Bucket: COMPANY }) }));
        expect(updateCompanyFun).toHaveBeenCalledWith(...bucketSizeUpdate('4'));
    });

    it('rejects when the company list cannot be read', async () => {
        getCompanyDataFun.mockRejectedValue(new Error('mongo down'));
        const { handleBucketSizeUpdateCron } = require('../common-storage/common-wasabi');
        expect(await outcome(handleBucketSizeUpdateCron())).toBe('rejected');
        expect(s3Send).not.toHaveBeenCalled();
    });
});
