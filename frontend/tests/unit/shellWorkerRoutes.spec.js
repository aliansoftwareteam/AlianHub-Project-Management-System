import { describe, it, expect } from 'vitest';
import rules from '@/serviceWorker/rules';

const { ROUTE, routeFor, shellAssetsOf } = rules;

const ORIGIN = 'https://hub.example.com';
const precached = new Set(['/index.html', '/manifest.webmanifest', '/js/app.19d59917.js', '/css/app.6c5db38f.css', '/fonts/inter.1a2b3c4d.woff2', '/icons/icon-192.png']);
const lazy = new Set(['/js/1057.1f479109.js', '/css/gantt.0a1b2c3d.css', '/img/default_user.0a1b2c3d.png']);
const route = (path, request = {}) => routeFor({ method: 'GET', url: `${ORIGIN}${path}`, mode: 'no-cors', destination: 'script', headers: {}, ...request }, { origin: ORIGIN, precached, lazy });
const page = (path) => route(path, { mode: 'navigate', destination: 'document' });

describe('what the worker answers', () => {
    it('answers a page load of the app root with the shell', () => {
        expect(page('/')).toBe(ROUTE.SHELL);
        expect(page('/index.html')).toBe(ROUTE.SHELL);
    });

    it('answers the files a first paint needs from the precache', () => {
        expect(route('/js/app.19d59917.js')).toBe(ROUTE.PRECACHE);
        expect(route('/css/app.6c5db38f.css', { destination: 'style' })).toBe(ROUTE.PRECACHE);
        expect(route('/fonts/inter.1a2b3c4d.woff2', { destination: 'font', mode: 'cors' })).toBe(ROUTE.PRECACHE);
        expect(route('/manifest.webmanifest', { destination: 'manifest' })).toBe(ROUTE.PRECACHE);
    });

    it('keeps the other hashed files of this build as they are asked for', () => {
        expect(route('/js/1057.1f479109.js')).toBe(ROUTE.RUNTIME);
        expect(route('/css/gantt.0a1b2c3d.css', { destination: 'style' })).toBe(ROUTE.RUNTIME);
        expect(route('/img/default_user.0a1b2c3d.png', { destination: 'image' })).toBe(ROUTE.RUNTIME);
    });

    it('leaves a file that is not in this build\'s lists, hashed name or not, and any other path, to the network', () => {
        expect(route('/js/app.deadbeef.js')).toBe(ROUTE.NETWORK);
        expect(route('/js/1057.deadbeef.js')).toBe(ROUTE.NETWORK);
        expect(route('/img/other.9f8e7d6c.svg', { destination: 'image' })).toBe(ROUTE.NETWORK);
        expect(route('/logo.png', { destination: 'image' })).toBe(ROUTE.NETWORK);
        expect(page('/some/other/page')).toBe(ROUTE.NETWORK);
        expect(page('/js/app.19d59917.js')).toBe(ROUTE.NETWORK);
        expect(page('/js/1057.1f479109.js')).toBe(ROUTE.NETWORK);
    });
});

describe('what the build hands the worker', () => {
    const emitted = [
        { name: 'index.html', immutable: false },
        { name: 'manifest.webmanifest', immutable: false },
        { name: 'js/chunk-vendors.f6a982e8.js', immutable: true },
        { name: 'js/app.19d59917.js', immutable: true },
        { name: 'js/app.19d59917.js.map', immutable: true },
        { name: 'js/chunk-vendors.f6a982e8.js.LICENSE.txt', immutable: false },
        { name: 'css/app.6c5db38f.css', immutable: true },
        { name: 'js/login.c9387891.js', immutable: true },
        { name: 'css/login.d2d6c51a.css', immutable: true },
        { name: 'js/1057.1f479109.js', immutable: true },
        { name: 'js/1057.1f479109.js.map', immutable: true },
        { name: 'css/gantt.0a1b2c3d.css', immutable: true },
        { name: 'fonts/inter.1a2b3c4d.woff2', immutable: true },
        { name: 'icons/icon-192.png', immutable: false },
        { name: 'img/default_user.0a1b2c3d.png', immutable: true },
        { name: 'img/unhashed.png', immutable: false },
        { name: 'logo.png', immutable: false },
        { name: 'favicon.png', immutable: false },
        { name: 'firebase-messaging-sw.js', immutable: false },
        { name: 'sw.js', immutable: false },
    ];
    const firstPaint = new Set(['js/chunk-vendors.f6a982e8.js', 'js/app.19d59917.js', 'css/app.6c5db38f.css', 'js/login.c9387891.js', 'css/login.d2d6c51a.css']);
    const shell = shellAssetsOf(emitted, firstPaint);

    it('precaches the document, the manifest, the first-paint scripts and styles, fonts and icons', () => {
        expect(shell.hashed).toEqual(['/css/app.6c5db38f.css', '/css/login.d2d6c51a.css', '/fonts/inter.1a2b3c4d.woff2', '/js/app.19d59917.js', '/js/chunk-vendors.f6a982e8.js', '/js/login.c9387891.js']);
        expect(shell.plain).toEqual(['/icons/icon-192.png', '/index.html', '/manifest.webmanifest']);
    });

    it('lists every other hashed script, style and image to be kept on first use', () => {
        expect(shell.lazy).toEqual(['/css/gantt.0a1b2c3d.css', '/img/default_user.0a1b2c3d.png', '/js/1057.1f479109.js']);
    });

    it('lists no source map, licence file, unhashed image, other worker or itself anywhere', () => {
        const listed = [...shell.hashed, ...shell.plain, ...shell.lazy];
        for (const name of ['/js/app.19d59917.js.map', '/js/1057.1f479109.js.map', '/js/chunk-vendors.f6a982e8.js.LICENSE.txt', '/img/unhashed.png', '/logo.png', '/favicon.png', '/firebase-messaging-sw.js', '/sw.js']) {
            expect(listed, name).not.toContain(name);
        }
    });
});
