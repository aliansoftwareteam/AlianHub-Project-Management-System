const mockRedirect = { dir: null };

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/storage/server/helpers/downloadHeaders.js', () => ({ sendStoredFile: jest.fn() }));
jest.mock('../Modules/storage/server/helpers/bucket.helper.js', () => ({
    createBucketHelper: jest.fn(),
    getBucketSizeCompanyWiseStorage: jest.fn(),
    iconsThumbnailGenerator: jest.fn(),
    generateSignedUrl: jest.fn(),
    checkBucketInDB: jest.fn(),
    uploadStorageThumbnailFile: jest.fn(),
}));
jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    const realRoot = require('path').resolve(__dirname, '../storage');
    const swap = (p) => (mockRedirect.dir && typeof p === 'string' && p.startsWith(realRoot) ? mockRedirect.dir + p.slice(realRoot.length) : p);
    return {
        ...real,
        existsSync: (p) => real.existsSync(swap(p)),
        unlinkSync: (p) => real.unlinkSync(swap(p)),
        mkdirSync: (p, o) => real.mkdirSync(swap(p), o),
        writeFile: (p, ...rest) => real.writeFile(swap(p), ...rest),
        promises: { ...real.promises, rm: (p, o) => real.promises.rm(swap(p), o), unlink: (p) => real.promises.unlink(swap(p)) },
    };
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { sendStoredFile } = require('../Modules/storage/server/helpers/downloadHeaders.js');
const helper = require('../Modules/storage/server/helpers/bucket.helper.js');
const ctrl = require('../Modules/storage/server/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';

const reply = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const settle = async (res) => {
    for (let waited = 0; res.body === undefined && waited < 2000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};
const onDisk = (...parts) => path.join(mockRedirect.dir, ...parts);
const put = (rel, content = 'x') => {
    fs.mkdirSync(path.dirname(onDisk(rel)), { recursive: true });
    fs.writeFileSync(onDisk(rel), content);
};

beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'unit-secret';
    mockRedirect.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-ctrl-'));
});

afterEach(() => {
    fs.rmSync(mockRedirect.dir, { recursive: true, force: true });
    mockRedirect.dir = null;
});

describe('createBucketOnStorage', () => {
    const create = async (body) => {
        const res = reply();
        await ctrl.createBucketOnStorage({ body }, res);
        return res;
    };

    it('asks for a bucketId and a non-empty rule before creating anything', async () => {
        expect((await create({ rule: { isPrivate: true } })).body).toEqual({ success: false, statusText: 'bucketId is required' });
        expect((await create({ bucketId: COMPANY })).body.statusText).toBe('rule is required');
        expect((await create({ bucketId: COMPANY, rule: {} })).body.statusText).toBe('rule is required');
        expect(helper.createBucketHelper).not.toHaveBeenCalled();
    });

    it.each(['a/b', '.hidden', 'trailing.', 'a?b', 'x\\y', ''])('refuses the bucket name %j', async (bucketId) => {
        const res = await create({ bucketId, rule: { isPrivate: true } });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe(bucketId ? 'Bucket name is not valid' : 'bucketId is required');
        expect(helper.createBucketHelper).not.toHaveBeenCalled();
    });

    it('hands the whole body to the helper and answers 200 when the bucket is made', async () => {
        helper.createBucketHelper.mockResolvedValue({ status: true });
        const body = { bucketId: COMPANY, rule: { isPrivate: true } };
        const res = await create(body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, statusText: 'Bucket created successfully' });
        expect(helper.createBucketHelper).toHaveBeenCalledWith(body);
    });

    it('tells an existing bucket apart from a failed creation', async () => {
        const body = { bucketId: COMPANY, rule: { isPrivate: false } };
        helper.createBucketHelper.mockResolvedValueOnce({ status: false, isExists: true });
        expect((await create(body)).body.statusText).toBe('Bucket already exists');
        helper.createBucketHelper.mockResolvedValueOnce({ status: false });
        expect((await create(body)).body.statusText).toBe('Bucket creation failed');
        helper.createBucketHelper.mockResolvedValueOnce(undefined);
        const res = await create(body);
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('Bucket creation failed');
    });
});

describe('getBucketOnStorage', () => {
    it('looks the bucket up by id in the global database and returns it', async () => {
        const bucket = { id: COMPANY, rule: { isPrivate: true } };
        MongoDbCrudOpration.mockResolvedValue(bucket);
        const res = reply();
        await ctrl.getBucketOnStorage({ params: { bucketId: COMPANY } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'Bucket found', data: bucket });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: 'buckets', data: [{ id: COMPANY }] }, 'findOne');
    });

    it('answers 404 for an unknown bucket and 400 when the lookup throws', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        const missing = reply();
        await ctrl.getBucketOnStorage({ params: { bucketId: OTHER_COMPANY } }, missing);
        expect(missing.statusCode).toBe(404);
        expect(missing.body.statusText).toBe('Bucket not found');

        MongoDbCrudOpration.mockRejectedValueOnce(new Error('db down'));
        const broken = reply();
        await ctrl.getBucketOnStorage({ params: { bucketId: COMPANY } }, broken);
        expect(broken.statusCode).toBe(400);
        expect(broken.body.message).toBe('db down');
    });
});

describe('updateBucketOnStorage', () => {
    it('asks for a bucketId and a non-empty rule', () => {
        const noBucket = reply();
        ctrl.updateBucketOnStorage({ params: {}, body: { rule: { isPrivate: true } } }, noBucket);
        expect(noBucket.body.statusText).toBe('bucketId is required');
        const noRule = reply();
        ctrl.updateBucketOnStorage({ params: { bucketId: COMPANY }, body: { rule: {} } }, noRule);
        expect(noRule.body.statusText).toBe('rule is required');
        const absent = reply();
        ctrl.updateBucketOnStorage({ params: { bucketId: COMPANY }, body: {} }, absent);
        expect(absent.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('sets only the rule of the named bucket and returns the new document', async () => {
        const updated = { id: COMPANY, rule: { isPrivate: false } };
        MongoDbCrudOpration.mockResolvedValue(updated);
        const res = reply();
        ctrl.updateBucketOnStorage({ params: { bucketId: COMPANY }, body: { rule: { isPrivate: false } } }, res);
        await settle(res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(updated);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', {
            type: 'buckets',
            data: [{ id: COMPANY }, { $set: { rule: { isPrivate: false } } }, { new: true }],
        }, 'findOneAndUpdate');
    });

    it('answers 400 for an unknown bucket and when the update fails', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        const missing = reply();
        ctrl.updateBucketOnStorage({ params: { bucketId: COMPANY }, body: { rule: { a: 1 } } }, missing);
        await settle(missing);
        expect(missing.statusCode).toBe(400);
        expect(missing.body.statusText).toBe('Bucket not found');

        MongoDbCrudOpration.mockRejectedValueOnce('write failed');
        const failed = reply();
        ctrl.updateBucketOnStorage({ params: { bucketId: COMPANY }, body: { rule: { a: 1 } } }, failed);
        await settle(failed);
        expect(failed.statusCode).toBe(400);
        expect(failed.body).toEqual({ success: false, statusText: 'write failed' });
    });
});

describe('removeBucketOnStorage', () => {
    it('deletes the bucket record and its files, and leaves other buckets alone', async () => {
        put(`${COMPANY}/a/one.txt`);
        put(`${OTHER_COMPANY}/two.txt`);
        MongoDbCrudOpration.mockResolvedValue({ id: COMPANY });
        const res = reply();
        await ctrl.removeBucketOnStorage({ params: { bucketId: COMPANY } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'Bucket removed', data: { id: COMPANY } });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: 'buckets', data: [{ id: COMPANY }] }, 'findOneAndDelete');
        expect(fs.existsSync(onDisk(COMPANY))).toBe(false);
        expect(fs.existsSync(onDisk(OTHER_COMPANY, 'two.txt'))).toBe(true);
    });

    it('answers 404 and removes no files for an unknown bucket', async () => {
        put(`${COMPANY}/one.txt`);
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = reply();
        await ctrl.removeBucketOnStorage({ params: { bucketId: COMPANY } }, res);
        expect(res.statusCode).toBe(404);
        expect(fs.existsSync(onDisk(COMPANY, 'one.txt'))).toBe(true);
    });

    it('answers 400 with the reason when the delete throws', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = reply();
        await ctrl.removeBucketOnStorage({ params: { bucketId: COMPANY } }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('db down');
    });
});

describe('getBucketSizeOnStorage', () => {
    it('measures the named bucket in the asked unit, defaulting to no unit', async () => {
        helper.getBucketSizeCompanyWiseStorage.mockResolvedValue(42);
        const res = reply();
        await ctrl.getBucketSizeOnStorage({ params: { bucketId: COMPANY }, query: { unit: 'MB' } }, res);
        expect(res.body).toEqual({ status: true, statusText: 'Bucket size', data: 42 });
        expect(helper.getBucketSizeCompanyWiseStorage).toHaveBeenCalledWith(COMPANY, 'MB');

        await ctrl.getBucketSizeOnStorage({ params: { bucketId: COMPANY }, query: {} }, reply());
        expect(helper.getBucketSizeCompanyWiseStorage).toHaveBeenLastCalledWith(COMPANY, '');
    });

    it('answers 400 with the error message, or its statusText when it has none', async () => {
        helper.getBucketSizeCompanyWiseStorage.mockRejectedValueOnce(new Error('no such bucket'));
        const a = reply();
        await ctrl.getBucketSizeOnStorage({ params: { bucketId: COMPANY }, query: {} }, a);
        expect(a.statusCode).toBe(400);
        expect(a.body.message).toBe('no such bucket');

        helper.getBucketSizeCompanyWiseStorage.mockRejectedValueOnce({ statusText: 'bad unit' });
        const b = reply();
        await ctrl.getBucketSizeOnStorage({ params: { bucketId: COMPANY }, query: {} }, b);
        expect(b.body.message).toBe('bad unit');
    });
});

describe('uploadFileOnStorage', () => {
    const upload = async (req) => {
        const res = reply();
        await ctrl.uploadFileOnStorage({ body: {}, ...req }, res);
        await settle(res);
        return res;
    };
    const file = { path: '/tmp/x' };

    it('asks for a path first, then a verified bucket, then a file', async () => {
        expect((await upload({ storageBucket: COMPANY, file })).body.statusText).toBe('path is required');
        expect((await upload({ body: { path: 'a.txt' }, file })).statusCode).toBe(403);
        expect((await upload({ body: { path: 'a.txt' }, storageBucket: COMPANY })).body.statusText).toBe('file is required');
        expect((await upload({ body: { path: 'a.txt' }, storageBucket: COMPANY, file: {} })).body.statusText).toBe('file is required');
    });

    it('answers with the stored path when no thumbnail is asked for', async () => {
        const res = await upload({ body: { path: 'docs/a.txt' }, storageBucket: COMPANY, file });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'docs/a.txt' });
        expect(helper.uploadStorageThumbnailFile).not.toHaveBeenCalled();
    });

    it('makes one thumbnail per size of the key, in the verified bucket', async () => {
        helper.uploadStorageThumbnailFile.mockResolvedValue(undefined);
        const sizes = require('../thumbnail.json').find((entry) => entry.key === 'userProfile').size;
        const res = await upload({ body: { path: 'me.png', key: 'userProfile' }, storageBucket: COMPANY, file });
        expect(res.body).toEqual({ status: true, statusText: 'me.png' });
        expect(helper.uploadStorageThumbnailFile.mock.calls).toEqual(sizes.map((s) => ['me.png', s.height, s.width, COMPANY, file]));
    });

    it('deletes the stored upload and answers 400 for an unknown thumbnail key', async () => {
        put(`${COMPANY}/me.png`);
        const res = await upload({ body: { path: 'me.png', key: 'nope' }, storageBucket: COMPANY, file });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('invalid thumbnail key');
        expect(fs.existsSync(onDisk(COMPANY, 'me.png'))).toBe(false);
    });
});

describe('getSignedUrlFile', () => {
    const sign = async (query, params = { bucketId: COMPANY }) => {
        const res = reply();
        await ctrl.getSignedUrlFile({ query, params }, res);
        return res;
    };

    it('requires a filepath and a bucketId before looking at the database', async () => {
        expect((await sign({})).body.statusText).toBe('filepath is required');
        expect((await sign({ filepath: 'a.txt' }, {})).body.statusText).toBe('bucketId is required');
        expect(helper.checkBucketInDB).not.toHaveBeenCalled();
    });

    it('signs a link for a private bucket', async () => {
        helper.checkBucketInDB.mockResolvedValue({ rule: { isPrivate: true } });
        helper.generateSignedUrl.mockReturnValue('https://app/signed');
        const res = await sign({ filepath: 'a.txt', domainUrl: 'https://app' });
        expect(res.body).toEqual({ url: 'https://app/signed' });
        expect(helper.checkBucketInDB).toHaveBeenCalledWith(COMPANY);
        expect(helper.generateSignedUrl).toHaveBeenCalledWith(COMPANY, 'a.txt', 'https://app');
    });

    it('returns the plain download link for a public bucket without signing', async () => {
        helper.checkBucketInDB.mockResolvedValue({ rule: { isPrivate: false } });
        const res = await sign({ filepath: 'a/b.png', domainUrl: 'https://app' });
        expect(res.body).toEqual({ url: `https://app/api/v1/download/${COMPANY}/a/b.png` });
        expect(helper.generateSignedUrl).not.toHaveBeenCalled();
    });

    it('answers 404 for a bucket that is missing or empty', async () => {
        helper.checkBucketInDB.mockResolvedValueOnce(null);
        expect((await sign({ filepath: 'a.txt' })).statusCode).toBe(404);
        helper.checkBucketInDB.mockResolvedValueOnce({});
        expect((await sign({ filepath: 'a.txt' })).body.statusText).toBe('Bucket not found');
    });
});

describe('handleFileRequest', () => {
    const token = (claims, secret = process.env.JWT_SECRET) => jwt.sign(claims, secret);
    const fetchFile = async ({ bucketId = COMPANY, filepath = 'a.txt', query = {} }) => {
        const res = reply();
        await ctrl.handleFileRequest({ params: { bucketId, 0: filepath }, query }, res);
        return res;
    };

    it('serves a file of a public bucket without a token', async () => {
        put(`${COMPANY}/a.txt`);
        helper.checkBucketInDB.mockResolvedValue({ rule: { isPrivate: false } });
        const res = reply();
        await ctrl.handleFileRequest({ params: { bucketId: COMPANY, 0: 'a.txt' }, query: {} }, res);
        expect(sendStoredFile).toHaveBeenCalledWith(res, path.resolve(__dirname, '../storage', COMPANY, 'a.txt'));
    });

    it('answers 404 for a missing public file, a private bucket without a token, and an unknown bucket', async () => {
        helper.checkBucketInDB.mockResolvedValueOnce({ rule: { isPrivate: false } });
        expect((await fetchFile({})).body.statusText).toBe('Resorce Not Found');
        put(`${COMPANY}/a.txt`);
        helper.checkBucketInDB.mockResolvedValueOnce({ rule: { isPrivate: true } });
        expect((await fetchFile({})).body.statusText).toBe('Resorce Not Found on bucket');
        helper.checkBucketInDB.mockResolvedValueOnce(null);
        expect((await fetchFile({})).statusCode).toBe(404);
        expect(sendStoredFile).not.toHaveBeenCalled();
    });

    it('serves a signed link and passes the download flag through', async () => {
        put(`${COMPANY}/a.txt`);
        const t = token({ bucketId: COMPANY, filepath: 'a.txt' });
        const res = await fetchFile({ query: { token: t, download: '1' } });
        expect(sendStoredFile).toHaveBeenCalledWith(res, path.resolve(__dirname, '../storage', COMPANY, 'a.txt'), { download: true });
        await fetchFile({ query: { token: t } });
        expect(sendStoredFile).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), { download: false });
    });

    it('does not serve a link signed for another bucket or file, or with another secret', async () => {
        put(`${COMPANY}/a.txt`);
        put(`${OTHER_COMPANY}/a.txt`);
        const forOther = token({ bucketId: OTHER_COMPANY, filepath: 'a.txt' });
        expect((await fetchFile({ query: { token: forOther } })).statusCode).toBe(404);
        const forFile = token({ bucketId: COMPANY, filepath: 'b.txt' });
        expect((await fetchFile({ query: { token: forFile } })).statusCode).toBe(404);
        const forged = token({ bucketId: COMPANY, filepath: 'a.txt' }, 'other-secret');
        expect((await fetchFile({ query: { token: forged } })).statusCode).toBe(404);
        expect((await fetchFile({ query: { token: 'garbage' } })).statusCode).toBe(404);
        expect(sendStoredFile).not.toHaveBeenCalled();
    });

    it('answers 404 for a signed link whose file is gone or climbs out of the bucket', async () => {
        const gone = await fetchFile({ query: { token: token({ bucketId: COMPANY, filepath: 'a.txt' }) } });
        expect(gone.statusCode).toBe(404);
        const climb = await fetchFile({ filepath: '../x.txt', query: { token: token({ bucketId: COMPANY, filepath: '../x.txt' }) } });
        expect(climb.statusCode).toBe(404);
        expect(sendStoredFile).not.toHaveBeenCalled();
    });
});

describe('removeFileFromStorage', () => {
    const remove = (query, bucketId = COMPANY) => {
        const res = reply();
        ctrl.removeFileFromStorage({ params: { bucketId }, query }, res);
        return res;
    };

    it('asks for a filepath and a bucketId', () => {
        expect(remove({}).body.statusText).toBe('filepath is required');
        expect(remove({ filepath: 'a.txt' }, null).body.statusText).toBe('bucketId is required');
    });

    it('deletes the file in the named bucket only', () => {
        put(`${COMPANY}/docs/a.txt`);
        put(`${OTHER_COMPANY}/docs/a.txt`);
        const res = remove({ filepath: 'docs/a.txt' });
        expect(res.statusCode).toBe(200);
        expect(res.body.statusText).toBe('File deleted successfully');
        expect(fs.existsSync(onDisk(COMPANY, 'docs', 'a.txt'))).toBe(false);
        expect(fs.existsSync(onDisk(OTHER_COMPANY, 'docs', 'a.txt'))).toBe(true);
    });

    it('answers 404 for a missing file and for a path that climbs out of the bucket', () => {
        put(`${OTHER_COMPANY}/secret.txt`);
        expect(remove({ filepath: 'nope.txt' }).statusCode).toBe(404);
        const climb = remove({ filepath: `../${OTHER_COMPANY}/secret.txt` });
        expect(climb.statusCode).toBe(404);
        expect(fs.existsSync(onDisk(OTHER_COMPANY, 'secret.txt'))).toBe(true);
    });

    it('removes the thumbnails of a user profile image next to it, then the image', async () => {
        put(`${COMPANY}/u/me.png`);
        put(`${COMPANY}/u/me-20x20.png`);
        put(`${COMPANY}/u/me-22x22.png`);
        put(`${COMPANY}/u/other-20x20.png`);
        const res = remove({ filepath: 'u/me.png', thubmkey: 'userProfile' });
        await settle(res);
        expect(res.statusCode).toBe(200);
        expect(fs.readdirSync(onDisk(COMPANY, 'u'))).toEqual(['other-20x20.png']);
    });

    it('removes the thumbnails of another key from the bucket root before the file', async () => {
        const key = require('../thumbnail.json').find((entry) => entry.key !== 'userProfile');
        const { height, width } = key.size[0];
        put(`${COMPANY}/pic.png`);
        put(`${COMPANY}/pic-${height}x${width}.png`);
        const res = remove({ filepath: 'pic.png', thubmkey: key.key });
        await settle(res);
        expect(res.statusCode).toBe(200);
        expect(fs.readdirSync(onDisk(COMPANY))).toEqual([]);
    });

    it('answers 404 after clearing thumbnails when the main file is already gone', async () => {
        put(`${COMPANY}/u/me-20x20.png`);
        const res = remove({ filepath: 'u/me.png', thubmkey: 'userProfile' });
        await settle(res);
        expect(res.statusCode).toBe(404);
        expect(fs.existsSync(onDisk(COMPANY, 'u', 'me-20x20.png'))).toBe(false);
    });

    it.failing('answers when the thumbnail key is unknown (it sends nothing and the request hangs)', async () => {
        put(`${COMPANY}/a.png`);
        const res = remove({ filepath: 'a.png', thubmkey: 'not-a-key' });
        await settle(res);
        expect(res.body).toBeDefined();
        expect(fs.existsSync(onDisk(COMPANY, 'a.png'))).toBe(true);
    });
});

describe('uploadBase64FileOnServerStorage', () => {
    const upload = async (body, storageBucket = COMPANY) => {
        const res = reply();
        ctrl.uploadBase64FileOnServerStorage({ body, storageBucket }, res);
        await settle(res);
        return res;
    };
    const png = Buffer.from('hello').toString('base64');

    it('asks for a path, a verified bucket and a base64String, writing nothing meanwhile', async () => {
        expect((await upload({ base64String: png })).body.statusText).toBe('path is required');
        expect((await upload({ path: 'a.png', base64String: png }, null)).statusCode).toBe(403);
        expect((await upload({ path: 'a.png' })).body.statusText).toBe('base64String is required');
        expect((await upload({ path: 'a.png', base64String: '' })).statusCode).toBe(400);
        expect(helper.iconsThumbnailGenerator).not.toHaveBeenCalled();
        expect(fs.readdirSync(mockRedirect.dir)).toEqual([]);
    });

    it('writes the decoded bytes under the verified bucket, dropping a data-URI prefix', async () => {
        helper.iconsThumbnailGenerator.mockResolvedValue(undefined);
        const res = await upload({ path: 'icons/a.png', base64String: `data:image/png;base64,${png}`, key: 'userProfile' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'icons/a.png' });
        expect(fs.readFileSync(onDisk(COMPANY, 'icons', 'a.png'), 'utf8')).toBe('hello');
        expect(helper.iconsThumbnailGenerator).toHaveBeenCalledWith('icons/a.png', COMPANY, {}, Buffer.from('hello'), 'a.png', 'userProfile');
    });

    it('passes an empty key when none is sent', async () => {
        helper.iconsThumbnailGenerator.mockResolvedValue(undefined);
        await upload({ path: 'a.png', base64String: png });
        expect(helper.iconsThumbnailGenerator.mock.calls[0][5]).toBe('');
    });

    it('answers 400 and writes no file when the thumbnail generator fails', async () => {
        helper.iconsThumbnailGenerator.mockRejectedValue(new Error('sharp'));
        const res = await upload({ path: 'a.png', base64String: png });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('Error generating thumbnail');
        expect(fs.existsSync(onDisk(COMPANY, 'a.png'))).toBe(false);
    });
});

describe('resolveBucketFile', () => {
    it('returns nothing for an empty bucket id or a bucket id with a separator', () => {
        expect(ctrl.resolveBucketFile('', 'a.txt')).toBe('');
        expect(ctrl.resolveBucketFile(undefined, 'a.txt')).toBe('');
        expect(ctrl.resolveBucketFile('a/b', 'c.txt')).toBe('');
        expect(ctrl.resolveBucketFile('..', 'c.txt')).toBe('');
    });

    it('returns nothing for the bucket directory itself or a path that leaves it', () => {
        expect(ctrl.resolveBucketFile(COMPANY, '')).toBe('');
        expect(ctrl.resolveBucketFile(COMPANY, '.')).toBe('');
        expect(ctrl.resolveBucketFile(COMPANY, `../${OTHER_COMPANY}/a.txt`)).toBe('');
    });
});
