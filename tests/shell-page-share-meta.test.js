const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { originFor, shellPage } = require('../Config/shellPage');

const ROOT = path.join(__dirname, '..');
const template = () => fs.readFileSync(path.join(ROOT, 'frontend/public/index.html'), 'utf8');
const fakeReq = (host, protocol = 'https') => ({ protocol, get: (name) => (name === 'host' ? host : undefined) });

const servers = [];
const dirs = [];

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

/* fetch refuses to set Host, and the Host header is what the page is built from. */
const serve = async (html) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-page-'));
    dirs.push(dir);
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, html);
    const app = express();
    app.use(shellPage(file));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return (route, host) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: route, headers: { Host: host } }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        }).on('error', reject);
    });
};

describe('link preview tags in index.html', () => {
    it('has a title, a description and Open Graph and Twitter tags', () => {
        const html = template();
        expect(html).toMatch(/<title>[^<]*AlianHub[^<]*<\/title>/);
        for (const tag of ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:url"',
            'property="og:image"', 'name="twitter:card"', 'name="twitter:image"']) {
            expect(html).toContain(tag);
        }
    });

    it('points og:image at a 1200x630 image in the build', () => {
        expect(template()).toContain('content="__APP_ORIGIN__/og-image.png"');
        const bytes = fs.readFileSync(path.join(ROOT, 'frontend/public/og-image.png'));
        expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
    });
});

describe('shell page', () => {
    it('serves index.html with absolute preview URLs for the host asked for', async () => {
        const get = await serve('<meta property="og:image" content="__APP_ORIGIN__/og-image.png">');
        const res = await get('/', 'demo.alianhub.com');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).toBe('<meta property="og:image" content="http://demo.alianhub.com/og-image.png">');
        expect((await get('/index.html', 'demo.alianhub.com')).text).toContain('http://demo.alianhub.com/og-image.png');
        expect((await get('/other', 'demo.alianhub.com')).status).toBe(404);
    });

    it('takes the scheme from APIURL for its own host', () => {
        expect(originFor(fakeReq('demo.alianhub.com', 'http'), { APIURL: 'https://demo.alianhub.com/' })).toBe('https://demo.alianhub.com');
        expect(originFor(fakeReq('other.example.com'), { APIURL: 'https://demo.alianhub.com/' })).toBe('https://other.example.com');
        expect(originFor(fakeReq('localhost:4000', 'http'), {})).toBe('http://localhost:4000');
    });

    it('never echoes a Host header that is not a host name', () => {
        expect(originFor(fakeReq('evil.com"><script>'), { APIURL: 'https://demo.alianhub.com/' })).toBe('https://demo.alianhub.com');
        expect(originFor(fakeReq('evil.com"><script>'), {})).toBe('');
    });

    it('is registered ahead of the static handler in index.js', () => {
        const source = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
        const shell = source.indexOf("app.use(require('./Config/shellPage').shellPage(");
        expect(shell).toBeGreaterThan(-1);
        expect(shell).toBeLessThan(source.indexOf('app.use(express.static('));
    });
});
