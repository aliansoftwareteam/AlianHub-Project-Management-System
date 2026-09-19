/* The read side of the storage abstraction: bytes come from the company's own bucket under the
 * storage type the install runs, by a key that cannot leave that bucket, and never past the
 * size the caller allows. */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn((input) => ({ input })),
}));
jest.mock('../Config/aws.js', () => ({ region: 'us-east-1', wasabiAccessKey: 'k', wasabiSecretAccessKey: 's', wasabiEndPoint: 'https://s3.example.test' }));
jest.mock('../Config/config', () => ({ requestHandler: {} }));

const { readStoredFile, STORAGE_ROOT } = require('../common-storage/readStoredFile');

const COMPANY = '6f00000000000000005704c1';
const OTHER = '6f00000000000000005704c2';
const KEY = 'Project/6f00000000000000005704a1/Sprint/6f00000000000000005704b1/Attachment/s7s4-notes.txt';
const STORAGE_TYPE = process.env.STORAGE_TYPE;

const put = (companyId, key, content) => {
    const target = path.join(STORAGE_ROOT, companyId, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
};

afterEach(() => {
    [COMPANY, OTHER].forEach((companyId) => fs.rmSync(path.join(STORAGE_ROOT, companyId), { recursive: true, force: true }));
    if (STORAGE_TYPE === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = STORAGE_TYPE;
    mockSend.mockReset();
});

describe('server storage', () => {
    beforeEach(() => { process.env.STORAGE_TYPE = 'server'; });

    it('reads the file under the company\'s own directory', async () => {
        put(COMPANY, KEY, 'Tide tables are in the locker.');
        const out = await readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 });
        expect(out.buffer.toString('utf8')).toBe('Tide tables are in the locker.');
        expect(out.size).toBe(30);
    });

    it('never reads another company\'s file by the same key', async () => {
        put(OTHER, KEY, 'Their notes.');
        await expect(readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('refuses a key that climbs out of the bucket, is absolute, or is a url', async () => {
        put(OTHER, KEY, 'Their notes.');
        for (const key of [`../${OTHER}/${KEY}`, `Project/../../${OTHER}/${KEY}`, `/etc/hosts`, 'https://example.test/notes.txt', 'file:///etc/hosts', '', null, 'a\0b']) {
            await expect(readStoredFile({ companyId: COMPANY, key, maxBytes: 1024 })).rejects.toMatchObject({ code: 'invalid_key' });
        }
    });

    it('refuses a company id that is not one', async () => {
        for (const companyId of ['', '..', 'USER_PROFILES', `${COMPANY}/..`]) {
            await expect(readStoredFile({ companyId, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'invalid_key' });
        }
    });

    it('refuses a file over the size allowed without reading it', async () => {
        put(COMPANY, KEY, 'x'.repeat(2048));
        const read = jest.spyOn(fs.promises, 'readFile');
        await expect(readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'too_large' });
        expect(read).not.toHaveBeenCalled();
        read.mockRestore();
    });

    it('refuses a directory', async () => {
        put(COMPANY, KEY, 'x');
        await expect(readStoredFile({ companyId: COMPANY, key: path.dirname(KEY), maxBytes: 1024 })).rejects.toMatchObject({ code: 'not_found' });
    });
});

describe('wasabi storage', () => {
    beforeEach(() => { process.env.STORAGE_TYPE = 'wasabi'; });

    it('asks for the key in the bucket named after the company', async () => {
        mockSend.mockResolvedValue({ ContentLength: 5, Body: Readable.from([Buffer.from('hello')]) });
        const out = await readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 });
        expect(out.buffer.toString('utf8')).toBe('hello');
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend.mock.calls[0][0].input).toEqual({ Bucket: COMPANY, Key: KEY });
    });

    it('refuses an object the bucket says is over the size allowed, and drops the stream', async () => {
        const body = Readable.from([Buffer.alloc(10)]);
        mockSend.mockResolvedValue({ ContentLength: 4096, Body: body });
        await expect(readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'too_large' });
        expect(body.destroyed).toBe(true);
    });

    it('stops reading a stream that runs past the size allowed, whatever length was declared', async () => {
        mockSend.mockResolvedValue({ ContentLength: 10, Body: Readable.from([Buffer.alloc(800), Buffer.alloc(800)]) });
        await expect(readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'too_large' });
    });

    it('reports a missing object as not found', async () => {
        mockSend.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }));
        await expect(readStoredFile({ companyId: COMPANY, key: KEY, maxBytes: 1024 })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('never asks the bucket for a key that climbs out of it', async () => {
        await expect(readStoredFile({ companyId: COMPANY, key: `../${OTHER}/${KEY}`, maxBytes: 1024 })).rejects.toMatchObject({ code: 'invalid_key' });
        expect(mockSend).not.toHaveBeenCalled();
    });
});
