const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const guard = require('../utils/imageGuard');

const KEEP = ['MAX_IMAGE_FILE_BYTES', 'MAX_IMAGE_PIXELS'];
const saved = {};
let dir;
let png;

const makePng = (width, height) => sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer();

beforeAll(async () => {
    KEEP.forEach((k) => { saved[k] = process.env[k]; });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-guard-'));
    png = await makePng(40, 20);
});

afterAll(() => {
    KEEP.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => KEEP.forEach((k) => delete process.env[k]));

describe('getLimits', () => {
    it('allows 25 MB and 50 megapixels by default', () => {
        expect(guard.getLimits()).toEqual({ MAX_BYTES: 25 * 1024 * 1024, MAX_PIXELS: 50000000 });
    });

    it('reads both limits from the environment', () => {
        process.env.MAX_IMAGE_FILE_BYTES = '4096';
        process.env.MAX_IMAGE_PIXELS = '100';
        expect(guard.getLimits()).toEqual({ MAX_BYTES: 4096, MAX_PIXELS: 100 });
    });

    it('never lets the byte limit fall below 1 KB', () => {
        process.env.MAX_IMAGE_FILE_BYTES = '10';
        expect(guard.getLimits().MAX_BYTES).toBe(1024);
    });

    it('ignores a value that is not a number', () => {
        process.env.MAX_IMAGE_FILE_BYTES = 'lots';
        process.env.MAX_IMAGE_PIXELS = '';
        expect(guard.getLimits()).toEqual({ MAX_BYTES: 25 * 1024 * 1024, MAX_PIXELS: 50000000 });
    });
});

describe('checkFileSizeBytes', () => {
    it('accepts a size at the limit and refuses one over it', () => {
        process.env.MAX_IMAGE_FILE_BYTES = '2048';
        expect(() => guard.checkFileSizeBytes(2048)).not.toThrow();
        let error;
        try { guard.checkFileSizeBytes(2049); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(guard.ImageGuardError);
        expect(error.code).toBe('IMAGE_TOO_LARGE');
        expect(error.statusCode).toBe(413);
        expect(error.details).toEqual({ size: 2049, maxBytes: 2048 });
    });

    it('does not judge a size that is not a finite number', () => {
        expect(() => guard.checkFileSizeBytes(undefined)).not.toThrow();
        expect(() => guard.checkFileSizeBytes('999999999999')).not.toThrow();
        expect(() => guard.checkFileSizeBytes(Infinity)).not.toThrow();
        expect(() => guard.checkFileSizeBytes(NaN)).not.toThrow();
    });
});

describe('checkBufferSize and checkPathSize', () => {
    it('refuses a buffer over the limit', () => {
        process.env.MAX_IMAGE_FILE_BYTES = '1024';
        expect(() => guard.checkBufferSize(Buffer.alloc(1025))).toThrow(/exceeds limit/);
        expect(() => guard.checkBufferSize(Buffer.alloc(1024))).not.toThrow();
    });

    it('lets a missing buffer through for sharp to report', () => {
        expect(() => guard.checkBufferSize(null)).not.toThrow();
        expect(() => guard.checkBufferSize({})).not.toThrow();
    });

    it('refuses a file over the limit and lets a missing file through', () => {
        process.env.MAX_IMAGE_FILE_BYTES = '1024';
        const big = path.join(dir, 'big.bin');
        fs.writeFileSync(big, Buffer.alloc(2000));
        expect(() => guard.checkPathSize(big)).toThrow(guard.ImageGuardError);
        expect(() => guard.checkPathSize(path.join(dir, 'missing.png'))).not.toThrow();
    });
});

describe('guardBuffer and guardFile', () => {
    it('returns the image details for a normal image', async () => {
        const meta = await guard.guardBuffer(png);
        expect(meta).toMatchObject({ width: 40, height: 20, format: 'png' });
        const file = path.join(dir, 'ok.png');
        fs.writeFileSync(file, png);
        expect(await guard.guardFile(file)).toMatchObject({ width: 40, height: 20 });
    });

    it('refuses an image with too many pixels even though the file is small', async () => {
        process.env.MAX_IMAGE_PIXELS = '500';
        await expect(guard.guardBuffer(png)).rejects.toMatchObject({
            code: 'IMAGE_TOO_MANY_PIXELS',
            statusCode: 413,
            details: { width: 40, height: 20, pixels: 800, maxPixels: 500 },
        });
    });

    it('accepts an image exactly at the pixel limit', async () => {
        process.env.MAX_IMAGE_PIXELS = '800';
        await expect(guard.guardBuffer(png)).resolves.toBeTruthy();
    });

    it('checks the size before reading the image', async () => {
        process.env.MAX_IMAGE_FILE_BYTES = '1024';
        await expect(guard.guardBuffer(Buffer.alloc(5000))).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    });

    it('fails on bytes that are not an image', async () => {
        await expect(guard.guardBuffer(Buffer.from('not an image at all'))).rejects.toThrow();
    });

    it('fails on a file that is not there', async () => {
        await expect(guard.guardFile(path.join(dir, 'gone.png'))).rejects.toThrow();
    });
});
