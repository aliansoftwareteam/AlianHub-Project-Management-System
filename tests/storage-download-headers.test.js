const fs = require('fs');
const path = require('path');

const PUBLIC_BUCKET = '6f00000000000000000a5e12';
const PRIVATE_BUCKET = '6f00000000000000000a5e13';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, q) => {
        const id = q && q.data && q.data[0] && q.data[0].id;
        if (id === '6f00000000000000000a5e12') return { id, rule: { isPrivate: false } };
        if (id === '6f00000000000000000a5e13') return { id, rule: { isPrivate: true } };
        return null;
    }),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 's8s12-download-secret';
process.env.JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';
process.env.JWT_EXP = process.env.JWT_EXP || '1h';

const express = require('express');
const { handleFileRequest } = require('../Modules/storage/server/controller');
const { generateSignedUrl } = require('../Modules/storage/server/helpers/bucket.helper');

const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');
const FOLDER = 's8s12';
const SANDBOX = "default-src 'none'; sandbox";
const OCTET = 'application/octet-stream';

/* Inline: what the app shows in an <img>, <video>, <audio>, a PDF tab or the text previewer. */
const INLINE = [
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['anim.gif', 'image/gif'],
    ['photo.webp', 'image/webp'],
    ['photo.avif', 'image/avif'],
    ['scan.bmp', 'image/bmp'],
    ['favicon.ico', 'image/x-icon'],
    ['report.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain; charset=utf-8'],
    ['server.log', 'text/plain; charset=utf-8'],
    ['clip.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['clip.mov', 'video/quicktime'],
    ['clip.ogv', 'video/ogg'],
    ['voice.mp3', 'audio/mpeg'],
    ['voice.m4a', 'audio/mp4'],
    ['voice.wav', 'audio/wav'],
    ['voice.ogg', 'audio/ogg'],
    ['voice.oga', 'audio/ogg'],
    ['voice.aac', 'audio/aac'],
    ['voice.flac', 'audio/flac'],
];

/* Everything else downloads: anything a browser could run as a page or a script, and anything unknown. */
const ATTACHMENT = ['payload.js', 'module.mjs', 'page.html', 'page.htm', 'drawing.svg', 'feed.xml', 'page.xhtml', 'sheet.css', 'data.json', 'table.csv',
    'readme.md', 'archive.zip', 'deck.pptx', 'binary.exe', 'no-extension', 'photo.PNG.html', 'weird.unknownext'];

let server;
let baseURL;

const fileAt = (bucket, name) => path.join(STORAGE_ROOT, bucket, FOLDER, name);

beforeAll(async () => {
    for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
        fs.mkdirSync(path.join(STORAGE_ROOT, bucket, FOLDER), { recursive: true });
        for (const [name] of INLINE) fs.writeFileSync(fileAt(bucket, name), 'bytes');
        for (const name of ATTACHMENT) fs.writeFileSync(fileAt(bucket, name), '<script>alert(document.domain)</script>');
    }
    const app = express();
    app.get('/api/v1/download/:bucketId/*', handleFileRequest);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) fs.rmSync(path.join(STORAGE_ROOT, bucket), { recursive: true, force: true });
});

const publicURL = (name) => `${baseURL}/api/v1/download/${PUBLIC_BUCKET}/${FOLDER}/${encodeURIComponent(name)}`;
const signedURL = (name, query = '') => `${generateSignedUrl(PRIVATE_BUCKET, `${FOLDER}/${name}`, baseURL)}${query}`;
const headersOf = async (url) => {
    const res = await fetch(url);
    await res.arrayBuffer();
    return { status: res.status, headers: Object.fromEntries(res.headers) };
};

const ROUTES = [['a public bucket', publicURL], ['a signed private link', (name) => signedURL(name)]];

describe.each(ROUTES)('stored files served from %s', (label, urlOf) => {
    it.each(INLINE)('shows %s inline as %s, with nosniff and a sandboxing policy', async (name, type) => {
        const { status, headers } = await headersOf(urlOf(name));
        expect(status).toBe(200);
        expect(headers['content-type']).toBe(type);
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['content-security-policy']).toBe(SANDBOX);
        expect(headers['content-disposition']).toBeUndefined();
    });

    it.each(ATTACHMENT)('serves %s as a download with a type no browser runs', async (name) => {
        const { status, headers } = await headersOf(urlOf(name));
        expect(status).toBe(200);
        expect(headers['content-type']).toBe(OCTET);
        expect(headers['content-disposition']).toMatch(/^attachment; filename="/);
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['content-security-policy']).toBe(SANDBOX);
    });
});

describe('a signed link asked to download', () => {
    it('downloads an inline type too, keeping its safe type', async () => {
        const { headers } = await headersOf(signedURL('photo.png', '&download=1'));
        expect(headers['content-type']).toBe('image/png');
        expect(headers['content-disposition']).toBe('attachment; filename="photo.png"');
        expect(headers['content-security-policy']).toBe(SANDBOX);
    });

    it('never turns a script into its real type', async () => {
        const { headers } = await headersOf(signedURL('payload.js', '&download=1'));
        expect(headers['content-type']).toBe(OCTET);
        expect(headers['content-disposition']).toBe('attachment; filename="payload.js"');
    });
});

describe('what is not served', () => {
    it('answers 404 as before for a missing file or a bad token', async () => {
        expect((await headersOf(publicURL('missing.png'))).status).toBe(404);
        expect((await headersOf(`${baseURL}/api/v1/download/${PRIVATE_BUCKET}/${FOLDER}/photo.png?token=nope`)).status).toBe(404);
    });
});
