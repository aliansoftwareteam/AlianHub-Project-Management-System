import { describe, it, expect } from 'vitest';
import rules from '@/serviceWorker/rules';

const { ROUTE, routeFor, shellAssetsOf, isPrecachedAsset } = rules;

const ORIGIN = 'https://hub.example.com';
const precached = new Set(['/index.html', '/manifest.webmanifest', '/js/app.19d59917.js', '/css/app.6c5db38f.css', '/fonts/inter.1a2b3c4d.woff2', '/icons/icon-192.png']);
const route = (path, request = {}) => routeFor({ method: 'GET', url: `${ORIGIN}${path}`, mode: 'no-cors', destination: 'script', headers: {}, ...request }, { origin: ORIGIN, precached });
const page = (path) => route(path, { mode: 'navigate', destination: 'document' });

describe('what the worker answers', () => {
    it('answers a page load of the app root with the shell', () => {
        expect(page('/')).toBe(ROUTE.SHELL);
        expect(page('/index.html')).toBe(ROUTE.SHELL);
    });

    it('answers the files of the build from the precache', () => {
        expect(route('/js/app.19d59917.js')).toBe(ROUTE.PRECACHE);
        expect(route('/css/app.6c5db38f.css', { destination: 'style' })).toBe(ROUTE.PRECACHE);
        expect(route('/fonts/inter.1a2b3c4d.woff2', { destination: 'font', mode: 'cors' })).toBe(ROUTE.PRECACHE);
        expect(route('/manifest.webmanifest', { destination: 'manifest' })).toBe(ROUTE.PRECACHE);
    });

    it('keeps the hashed images of the build as they are asked for', () => {
        expect(route('/img/default_user.0a1b2c3d.png', { destination: 'image' })).toBe(ROUTE.RUNTIME);
        expect(route('/img/empty.9f8e7d6c.svg', { destination: 'image' })).toBe(ROUTE.RUNTIME);
    });

    it('leaves a build file it does not hold, and any other path, to the network', () => {
        expect(route('/js/app.deadbeef.js')).toBe(ROUTE.NETWORK);
        expect(route('/logo.png', { destination: 'image' })).toBe(ROUTE.NETWORK);
        expect(route('/img/photo.png', { destination: 'image' })).toBe(ROUTE.NETWORK);
        expect(route('/img/default_user.0a1b2c3d.png', { destination: '' })).toBe(ROUTE.NETWORK);
        expect(page('/some/other/page')).toBe(ROUTE.NETWORK);
        expect(page('/js/app.19d59917.js')).toBe(ROUTE.NETWORK);
    });
});

describe('what goes into the precache', () => {
    const emitted = [
        { name: 'index.html', immutable: false },
        { name: 'manifest.webmanifest', immutable: false },
        { name: 'js/app.19d59917.js', immutable: true },
        { name: 'js/app.19d59917.js.map', immutable: true },
        { name: 'js/chunk-vendors.f6a982e8.js.LICENSE.txt', immutable: false },
        { name: 'css/app.6c5db38f.css', immutable: true },
        { name: 'fonts/inter.1a2b3c4d.woff2', immutable: true },
        { name: 'icons/icon-192.png', immutable: false },
        { name: 'img/default_user.0a1b2c3d.png', immutable: true },
        { name: 'logo.png', immutable: false },
        { name: 'favicon.png', immutable: false },
        { name: 'firebase-messaging-sw.js', immutable: false },
        { name: 'sw.js', immutable: false },
    ];

    it('takes the document, the manifest, scripts, styles, fonts and icons', () => {
        expect(shellAssetsOf(emitted)).toEqual({
            hashed: ['/css/app.6c5db38f.css', '/fonts/inter.1a2b3c4d.woff2', '/js/app.19d59917.js'],
            plain: ['/icons/icon-192.png', '/index.html', '/manifest.webmanifest'],
        });
    });

    it('leaves out source maps, licence files, images, other workers and itself', () => {
        for (const name of ['js/app.19d59917.js.map', 'js/chunk-vendors.f6a982e8.js.LICENSE.txt', 'img/default_user.0a1b2c3d.png', 'logo.png', 'firebase-messaging-sw.js', 'sw.js']) {
            expect(isPrecachedAsset(name), name).toBe(false);
        }
    });
});
