import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';
import rules from '@/serviceWorker/rules';

const { MESSAGE } = rules;
const { renderWorker } = createRequire(import.meta.url)('../../shellWorkerPlugin.js');

const ORIGIN = 'https://hub.example.com';
const SOURCES = ['rules.js', 'worker.js'].map((file) => fs.readFileSync(path.resolve(__dirname, '../../src/serviceWorker', file), 'utf8'));
const SHELL = {
    version: 'build-2',
    hashed: ['/css/app.6c5db38f.css', '/js/1057.1f479109.js', '/js/app.22222222.js', '/js/chunk-vendors.f6a982e8.js'],
    plain: ['/icons/icon-192.png', '/index.html', '/manifest.webmanifest'],
};
const TYPES = { js: 'text/javascript', css: 'text/css', html: 'text/html; charset=utf-8', png: 'image/png', webmanifest: 'application/manifest+json' };

const pathOf = (key) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).pathname;

const response = (body, { type = 'basic', status = 200, redirected = false, contentType = 'text/plain' } = {}) => ({
    body,
    ok: status >= 200 && status < 300,
    status,
    redirected,
    type,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    clone() { return this; },
});

const served = (file) => response(`network:${file}`, { contentType: TYPES[file.split('.').pop()] });

const cacheStorage = (initial = {}) => {
    const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
    return {
        stores,
        keys: async () => [...stores.keys()],
        delete: async (name) => stores.delete(name),
        open: async (name) => {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return {
                match: async (key) => store.get(pathOf(key)),
                put: async (key, value) => { store.set(pathOf(key), value); },
            };
        },
    };
};

const boot = ({ caches = cacheStorage(), fetch = async (request) => served(pathOf(request)) } = {}) => {
    const listeners = {};
    const fetched = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const scope = {
        location: { origin: ORIGIN },
        skipWaitingCalls: 0,
        addEventListener: (type, handler) => { listeners[type] = handler; },
        skipWaiting: async () => { scope.skipWaitingCalls += 1; },
    };
    const context = vm.createContext({
        self: scope,
        caches,
        URL,
        Request: function Request(url, init) { Object.assign(this, { url: new URL(url, ORIGIN).href, method: 'GET', headers: new Map() }, init); },
        fetch: async (request) => {
            fetched.push(pathOf(request));
            inFlight += 1;
            mostInFlight = Math.max(mostInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 0));
            try {
                return await fetch(request);
            } finally {
                inFlight -= 1;
            }
        },
    });
    vm.runInContext(renderWorker(SHELL, SOURCES), context);

    const dispatch = async (type, event = {}) => {
        const waited = [];
        let answer;
        listeners[type]({ waitUntil: (promise) => waited.push(promise), respondWith: (promise) => { answer = promise; }, ...event });
        await Promise.all(waited);
        return { answered: answer !== undefined, response: answer };
    };
    const ask = (url, extra = {}) => dispatch('fetch', { request: { method: 'GET', url: `${ORIGIN}${url}`, mode: 'cors', destination: '', headers: new Map(), ...extra } });
    const page = (url) => ask(url, { mode: 'navigate', destination: 'document' });

    return { scope, caches, fetched, dispatch, ask, page, mostInFlight: () => mostInFlight };
};

const heldPaths = (caches) => [...caches.stores.values()].flatMap((store) => [...store.keys()]);

describe('installing', () => {
    it('holds every file of the build under the build\'s own cache, a few requests at a time', async () => {
        const worker = boot();
        await worker.dispatch('install');

        expect([...worker.caches.stores.keys()]).toEqual(['ah-shell-build-2']);
        expect(heldPaths(worker.caches).sort()).toEqual([...SHELL.hashed, ...SHELL.plain].sort());
        expect(worker.mostInFlight()).toBeLessThanOrEqual(4);
    });

    it('copies the files an earlier build already holds and downloads the rest', async () => {
        const caches = cacheStorage({ 'ah-shell-build-1': {
            '/js/chunk-vendors.f6a982e8.js': response('held:vendors'),
            '/index.html': response('held:old document'),
        } });
        const worker = boot({ caches });
        await worker.dispatch('install');

        expect(worker.fetched).not.toContain('/js/chunk-vendors.f6a982e8.js');
        expect(worker.fetched).toContain('/index.html');
        expect(caches.stores.get('ah-shell-build-2').get('/js/chunk-vendors.f6a982e8.js').body).toBe('held:vendors');
        expect(caches.stores.get('ah-shell-build-2').get('/index.html').body).toBe('network:/index.html');
    });

    it.each([
        ['a sign-in page in place of a script', () => response('<html>sign in</html>', { contentType: 'text/html' })],
        ['a redirect', () => response('moved', { redirected: true, contentType: 'text/javascript' })],
        ['an error', () => response('gone', { status: 404, contentType: 'text/javascript' })],
        ['an answer from another origin', () => response('', { type: 'opaque', contentType: 'text/javascript' })],
    ])('gives up and keeps nothing when a file comes back as %s', async (label, wrong) => {
        const worker = boot({ fetch: async (request) => (pathOf(request) === '/js/app.22222222.js' ? wrong() : served(pathOf(request))) });

        await expect(worker.dispatch('install')).rejects.toThrow('/js/app.22222222.js');
        expect([...worker.caches.stores.keys()]).toEqual([]);
    });

    it('does not take over from the worker in use', async () => {
        const worker = boot();
        await worker.dispatch('install');
        await worker.dispatch('activate');
        expect(worker.scope.skipWaitingCalls).toBe(0);
    });
});

describe('taking over', () => {
    it('waits for a tab to ask', async () => {
        const worker = boot();
        await worker.dispatch('message', { data: { type: 'something-else' } });
        expect(worker.scope.skipWaitingCalls).toBe(0);

        await worker.dispatch('message', { data: { type: MESSAGE.ACTIVATE } });
        expect(worker.scope.skipWaitingCalls).toBe(1);
    });

    it('removes the builds before it and leaves other caches alone', async () => {
        const caches = cacheStorage({ 'ah-shell-build-1': { '/index.html': response('old') }, 'ah-runtime-v1': { '/img/a.0a1b2c3d.png': response('image') } });
        const worker = boot({ caches });
        await worker.dispatch('install');
        await worker.dispatch('activate');
        expect([...caches.stores.keys()].sort()).toEqual(['ah-runtime-v1', 'ah-shell-build-2']);
    });

    it('tells a tab which build it holds', async () => {
        const worker = boot();
        const replies = [];
        await worker.dispatch('message', { data: { type: MESSAGE.DESCRIBE }, ports: [{ postMessage: (reply) => replies.push(reply) }] });
        expect(replies).toEqual([{ version: 'build-2', assets: [...SHELL.hashed, ...SHELL.plain] }]);
    });
});

describe('answering requests', () => {
    it('does not answer the API, sockets, downloads, shared pages or sign-in endpoints', async () => {
        const worker = boot();
        await worker.dispatch('install');
        worker.fetched.length = 0;

        for (const url of ['/api/v2/tasks', '/api/v1/download/1/a.pdf', '/socket.io/?EIO=4', '/share/abc', '/form/abc', '/oauth/consent', '/api/v2/auth/login']) {
            expect((await worker.ask(url)).answered, url).toBe(false);
            expect((await worker.page(url)).answered, url).toBe(false);
        }
        expect((await worker.ask('/js/app.22222222.js', { headers: new Map([['authorization', 'Bearer abc']]) })).answered).toBe(false);
        expect((await worker.page('/?token=abc')).answered).toBe(false);
        expect(worker.fetched).toEqual([]);
    });

    it('answers a page load from the network while there is one', async () => {
        const worker = boot();
        await worker.dispatch('install');
        const { answered, response: answer } = await worker.page('/');
        expect(answered).toBe(true);
        expect((await answer).body).toBe('network:/');
    });

    it('answers a page load with the held document when the network gives no answer', async () => {
        let online = true;
        const worker = boot({ fetch: async (request) => {
            if (!online) throw new TypeError('Failed to fetch');
            return served(pathOf(request));
        } });
        await worker.dispatch('install');
        online = false;

        expect((await (await worker.page('/')).response).body).toBe('network:/index.html');
        await expect((await worker.page('/api/v2/tasks')).answered).toBe(false);
    });

    it('fails a page load, with nothing held, the way the network failed', async () => {
        const worker = boot({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
        await expect((await worker.page('/')).response).rejects.toThrow('Failed to fetch');
    });

    it('shows a server error as it is and does not cover it with the held document', async () => {
        let failing = false;
        const worker = boot({ fetch: async (request) => (failing ? response('bad gateway', { status: 502 }) : served(pathOf(request))) });
        await worker.dispatch('install');
        failing = true;
        expect((await (await worker.page('/')).response).status).toBe(502);
    });

    it('answers the files of the build from what it holds, without the network', async () => {
        const worker = boot();
        await worker.dispatch('install');
        worker.fetched.length = 0;

        expect((await (await worker.ask('/js/app.22222222.js', { destination: 'script' })).response).body).toBe('network:/js/app.22222222.js');
        expect(worker.fetched).toEqual([]);
    });

    it('keeps a build image the first time it is asked for, and only a good answer', async () => {
        const worker = boot({ fetch: async (request) => (pathOf(request).includes('missing') ? response('', { status: 404 }) : served(pathOf(request))) });
        const image = { mode: 'no-cors', destination: 'image' };

        await (await worker.ask('/img/default_user.0a1b2c3d.png', image)).response;
        await (await worker.ask('/img/missing.0a1b2c3d.png', image)).response;
        worker.fetched.length = 0;
        await (await worker.ask('/img/default_user.0a1b2c3d.png', image)).response;

        expect([...worker.caches.stores.get('ah-runtime-v1').keys()]).toEqual(['/img/default_user.0a1b2c3d.png']);
        expect(worker.fetched).toEqual([]);
    });
});

describe('when the person signs out or changes workspace', () => {
    it('drops every cache except the builds, including a build that is still waiting', async () => {
        const caches = cacheStorage({
            'ah-shell-build-3': { '/index.html': response('waiting build') },
            'ah-runtime-v1': { '/img/a.0a1b2c3d.png': response('image') },
            'some-other-cache': { '/api/v2/tasks': response('private') },
        });
        const worker = boot({ caches });
        await worker.dispatch('install');

        await worker.dispatch('message', { data: { type: MESSAGE.DROP_RUNTIME_CACHES } });

        expect([...caches.stores.keys()].sort()).toEqual(['ah-shell-build-2', 'ah-shell-build-3']);
    });
});

describe('what it ends up holding', () => {
    it('is the files of the build and build images, whatever was asked for', async () => {
        const worker = boot();
        await worker.dispatch('install');
        await worker.dispatch('activate');
        const asked = ['/', '/api/v2/tasks', '/api/v1/getlogo?key=favicon', '/api/v1/download/1/a.png', '/socket.io/?EIO=4', '/share/abc', '/js/app.22222222.js',
            '/img/default_user.0a1b2c3d.png', '/storage/company/a.0a1b2c3d.png', '/logo.png'];
        for (const url of asked) {
            for (const extra of [{}, { mode: 'navigate', destination: 'document' }, { mode: 'no-cors', destination: 'image' }]) {
                const { response: answer } = await worker.ask(url, extra);
                if (answer) await answer;
            }
        }

        expect(heldPaths(worker.caches).sort()).toEqual([...SHELL.hashed, ...SHELL.plain, '/img/default_user.0a1b2c3d.png'].sort());
    });
});
