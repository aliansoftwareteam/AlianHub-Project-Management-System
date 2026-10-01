import { describe, it, expect } from 'vitest';
import rules from '@/serviceWorker/rules';

const { ROUTE, routeFor, reasonToStayOut } = rules;

const ORIGIN = 'https://hub.example.com';
const precached = new Set(['/index.html', '/js/app.19d59917.js']);
const request = (url, extra = {}) => ({ method: 'GET', url: url.startsWith('http') ? url : `${ORIGIN}${url}`, mode: 'cors', destination: '', headers: {}, ...extra });
const route = (url, extra) => routeFor(request(url, extra), { origin: ORIGIN, precached });
const asPage = { mode: 'navigate', destination: 'document' };
const asImage = { mode: 'no-cors', destination: 'image' };

const everyWay = (url) => [route(url), route(url, asPage), route(url, asImage)];

describe('requests the worker leaves to the network', () => {
    it.each([
        '/api/v2/tasks',
        '/api/v1/task/6a350f0a383f83342195a939',
        '/api/v1/getlogo',
        '/API/v2/tasks',
        '/%61pi/v2/tasks',
        '//api/v2/tasks',
    ])('the API: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it.each([
        '/api/v1/download/6a350f0a383f83342195a939/report.pdf',
        '/api/v1/download/img/photo.0a1b2c3d.png',
        '/storage/company/file.0a1b2c3d.png',
        '/wasabiUploadsLocal/company/file.0a1b2c3d.png',
        '/share/Zm9vYmFy',
        '/share/Zm9vYmFy/page/6a350f0a383f83342195a939',
        '/form/Zm9vYmFy',
    ])('file downloads, stored files and shared pages: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it.each([
        '/socket.io/',
        '/socket.io/socket.io.js',
    ])('socket traffic: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it.each([
        '/api/v2/auth/login',
        '/api/v2/auth/generate-token',
        '/oauth/authorize',
        '/oauth/consent',
        '/oauth/token',
        '/.well-known/oauth-authorization-server',
        '/scim/v2/Users',
        '/mcp',
        '/mcp/manifest',
        '/pickers/google-drive',
        '/connections/6a350f0a383f83342195a939',
    ])('sign-in, consent and machine endpoints: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it.each(['/health', '/version', '/sw.js', '/firebase-messaging-sw.js', '/task-import/events/1', '/importUser/events/1', '/company-create/events/1'])('server answers of its own: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it.each([
        ['authorization', 'Bearer abc'],
        ['Authorization', 'Bearer abc'],
        ['refresh-token', 'abc'],
        ['companyId', '6a350f0a383f83342195a939'],
        ['x-api-key', 'abc'],
        ['range', 'bytes=0-100'],
    ])('anything sent with a %s header, even for a file it holds', (name, value) => {
        expect(route('/js/app.19d59917.js', { headers: { [name]: value } })).toBe(ROUTE.NETWORK);
        expect(route('/', { ...asPage, headers: new Map([[name.toLowerCase(), value]]) })).toBe(ROUTE.NETWORK);
        expect(reasonToStayOut(request('/', { headers: { [name]: value } }), ORIGIN)).toBe('credentials');
    });

    it.each([
        '/?token=abc',
        '/?access_token=abc',
        '/?code=abc&state=xyz',
        '/?X-Amz-Signature=abc',
        '/index.html?resetToken=abc',
        '/js/app.19d59917.js?key=abc',
        '/js/app.19d59917.js?sig=abc',
    ])('a secret in the address: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
        expect(reasonToStayOut(request(url), ORIGIN)).toBe('secret-in-url');
    });

    it('an address with a user name or a password in it', () => {
        expect(route('https://someone:secret@hub.example.com/', asPage)).toBe(ROUTE.NETWORK);
    });

    it('any address with a query, secret or not', () => {
        expect(route('/?utm_source=mail', asPage)).toBe(ROUTE.NETWORK);
        expect(route('/js/app.19d59917.js?v=2')).toBe(ROUTE.NETWORK);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('a %s request', (method) => {
        expect(route('/', { ...asPage, method })).toBe(ROUTE.NETWORK);
        expect(route('/js/app.19d59917.js', { method })).toBe(ROUTE.NETWORK);
    });

    it.each([
        'https://s3.wasabisys.com/bucket/file.png',
        'https://bucket.s3.wasabisys.com/file.png?X-Amz-Signature=abc',
        'https://fonts.gstatic.com/s/inter/v1/font.woff2',
        'https://accounts.google.com/gsi/client',
        'http://hub.example.com/',
        'https://hub.example.com:8443/',
    ])('another origin: %s', (url) => {
        expect(everyWay(url)).toEqual([ROUTE.NETWORK, ROUTE.NETWORK, ROUTE.NETWORK]);
    });

    it('an address it cannot read', () => {
        expect(routeFor({ method: 'GET', url: 'not a url', mode: 'navigate', headers: {} }, { origin: ORIGIN, precached })).toBe(ROUTE.NETWORK);
    });
});
