/* The server driver keeps the same storage_usage counter as object storage: what an upload writes is
 * added, what a delete removes is taken off, and the nightly walk of storage/ sets the true figure. */
jest.mock('../common-storage/storageUsage', () => ({ add: jest.fn(async () => true) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));

const fs = require('fs');
const path = require('path');
const usage = require('../common-storage/storageUsage');
const diskUsage = require('../common-storage/diskUsage');
const { PUBLIC_OWNER } = require('../common-storage/s3Layout');

const COMPANY = '6f0000000000000000d15c01';
const bucketDir = path.join(diskUsage.STORAGE_ROOT, COMPANY);
const write = (relative, content) => {
    const file = path.join(bucketDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
};

beforeEach(() => usage.add.mockClear());
afterEach(() => fs.rmSync(bucketDir, { recursive: true, force: true }));

describe('the disk counter', () => {
    it('adds what was written, the difference when a file was written over, and skips a file not there', () => {
        const one = write('a/one.txt', 'hello');
        const two = write('a/two.txt', 'abc');
        diskUsage.countWritten(COMPANY, [one, two, path.join(bucketDir, 'missing.txt'), undefined]);
        expect(usage.add).toHaveBeenLastCalledWith(COMPANY, 8, 2);
        diskUsage.countWritten(COMPANY, [one], [12]);
        expect(usage.add).toHaveBeenLastCalledWith(COMPANY, -7, 0);
    });

    it('takes off only the files that are gone after a delete', () => {
        const one = write('a/one.txt', 'hello');
        const two = write('a/two.txt', 'abc');
        const sized = diskUsage.sized([one, two]);
        fs.unlinkSync(one);
        diskUsage.countRemoved(COMPANY, sized);
        expect(usage.add).toHaveBeenLastCalledWith(COMPANY, -5, -1);
    });

    it('counts avatars and public files under the public area', () => {
        expect(diskUsage.ownerOfBucket('USER_PROFILES')).toBe(PUBLIC_OWNER);
        expect(diskUsage.ownerOfBucket(COMPANY)).toBe(COMPANY);
        expect(diskUsage.dirOfOwner(PUBLIC_OWNER)).toBe(path.join(diskUsage.STORAGE_ROOT, 'USER_PROFILES'));
    });

    it('measures a folder by walking it, and an absent one as empty', async () => {
        write('a/one.txt', 'hello');
        write('a/b/c/deep.bin', Buffer.alloc(100));
        expect(await diskUsage.measureOwner(COMPANY)).toEqual({ bytes: 105, objects: 2 });
        expect(await diskUsage.measureOwner('6f0000000000000000d15c99')).toEqual({ bytes: 0, objects: 0 });
    });
});

describe('the server storage routes', () => {
    const ctrl = require('../Modules/storage/server/controller');
    const respond = () => {
        const res = { statusCode: 0, body: null };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (body) => { res.body = body; return res; };
        res.json = res.send;
        return res;
    };

    it('count a plain upload once multer has written it', async () => {
        const file = write('Project/p1/Attachment/notes.txt', 'notes!');
        const res = respond();
        await ctrl.uploadFileOnStorage({ storageBucket: COMPANY, body: { path: 'Project/p1/Attachment/notes.txt' }, file: { path: file } }, res);
        expect(res.statusCode).toBe(200);
        expect(usage.add).toHaveBeenCalledWith(COMPANY, 6, 1);
    });

    it('take a deleted file off the counter', () => {
        write('Project/p1/Attachment/old.txt', 'old file');
        const res = respond();
        ctrl.removeFileFromStorage({ params: { bucketId: COMPANY }, query: { filepath: 'Project/p1/Attachment/old.txt' } }, res);
        expect(res.statusCode).toBe(200);
        expect(usage.add).toHaveBeenCalledWith(COMPANY, -8, -1);
    });
});
