import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { flushPromises } from '@vue/test-utils';
import rules from '@/serviceWorker/rules';
import { shouldRegister, isDesktopShell, registerShellWorker, applyUpdate, dropWorkerRuntimeCaches, updateReady, resetShellWorkerState } from '@/serviceWorker/registration';

const { MESSAGE } = rules;
const ORIGIN = 'https://hub.example.com';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DESKTOP_APP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) alianhub-tracker/1.0.0 Chrome/128.0.0.0 Electron/32.1.0 Safari/537.36';

const emitter = () => {
    const handlers = {};
    return {
        addEventListener: (type, handler) => { (handlers[type] = handlers[type] || []).push(handler); },
        emit: async (type, event = {}) => { await Promise.all((handlers[type] || []).map((handler) => handler(event))); },
    };
};

/* A worker as a tab sees it. `assets` is what it answers when asked which build it holds. */
const fakeWorker = (assets) => {
    const worker = { ...emitter(), state: 'installing', posted: [] };
    worker.postMessage = (message, transfer) => {
        worker.posted.push(message.type);
        if (message.type === MESSAGE.DESCRIBE && assets && transfer) transfer[0].onmessage({ data: { version: 'v', assets } });
    };
    return worker;
};

const fakeWindow = ({ scripts = ['/js/app.11111111.js'], controller = null, userAgent = CHROME, secure = true, cacheNames = [] } = {}) => {
    const registration = { ...emitter(), waiting: null, installing: null, active: null, update: vi.fn().mockResolvedValue(undefined) };
    const container = { ...emitter(), controller, register: vi.fn().mockResolvedValue(registration) };
    const held = new Set(cacheNames);
    return {
        registration,
        container,
        held,
        isSecureContext: secure,
        navigator: { serviceWorker: container, userAgent, onLine: true },
        location: { origin: ORIGIN, reload: vi.fn() },
        document: { ...emitter(), visibilityState: 'visible', scripts: scripts.map((src) => ({ src: `${ORIGIN}${src}` })) },
        caches: { keys: async () => [...held], delete: async (name) => held.delete(name) },
        MessageChannel: class { constructor() { this.port1 = {}; this.port2 = this.port1; } },
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout,
    };
};

const production = { production: true };

beforeEach(() => resetShellWorkerState());

describe('where the worker is registered', () => {
    const browser = { production: true, supported: true, secure: true, userAgent: CHROME };

    it('is a production build in a browser on a secure address', () => {
        expect(shouldRegister(browser)).toBe(true);
    });

    it('is never the dev server, the desktop app, an insecure address or a browser without workers', () => {
        expect(shouldRegister({ ...browser, production: false })).toBe(false);
        expect(shouldRegister({ ...browser, userAgent: DESKTOP_APP })).toBe(false);
        expect(shouldRegister({ ...browser, secure: false })).toBe(false);
        expect(shouldRegister({ ...browser, supported: false })).toBe(false);
        expect(isDesktopShell(DESKTOP_APP)).toBe(true);
        expect(isDesktopShell(CHROME)).toBe(false);
    });

    it('registers /sw.js for the whole site and has the browser check it against the server every time', async () => {
        const win = fakeWindow();
        await registerShellWorker(win, production);
        expect(win.container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    });

    it('does not register from the dev server or the desktop app', async () => {
        const dev = fakeWindow();
        const desktop = fakeWindow({ userAgent: DESKTOP_APP });
        expect(await registerShellWorker(dev, { production: false })).toBe(null);
        expect(await registerShellWorker(desktop, production)).toBe(null);
        expect(dev.container.register).not.toHaveBeenCalled();
        expect(desktop.container.register).not.toHaveBeenCalled();
    });

    it('carries on when the browser refuses or blocks the registration', async () => {
        const refused = fakeWindow();
        refused.container.register = vi.fn().mockRejectedValue(new Error('blocked'));
        const blocked = fakeWindow();
        blocked.container.register = vi.fn().mockResolvedValue(undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await registerShellWorker(refused, production)).toBe(null);
        expect(await registerShellWorker(blocked, production)).toBe(null);
        warn.mockRestore();
    });
});

describe('a worker the server has withdrawn', () => {
    const answering = (win, headers) => {
        win.fetch = vi.fn().mockResolvedValue({ headers: { get: (name) => headers[name] || null } });
        return win;
    };
    const withdrawn = (win) => answering(win, { 'x-app-shell-worker': 'withdrawn' });

    it('is asked about with a HEAD request that no cache answers', async () => {
        const win = answering(fakeWindow(), {});
        await registerShellWorker(win, production);
        expect(win.fetch).toHaveBeenCalledWith('/sw.js', { method: 'HEAD', cache: 'no-store' });
        expect(win.container.register).toHaveBeenCalledTimes(1);
    });

    it('is not registered again, and the page removes the registration and every cache it can reach', async () => {
        const win = withdrawn(fakeWindow({ cacheNames: ['ah-shell-build-1', 'ah-runtime-v1'] }));
        const existing = { active: { scriptURL: `${ORIGIN}/sw.js` }, unregister: vi.fn().mockResolvedValue(true) };
        win.container.getRegistration = vi.fn().mockResolvedValue(existing);

        expect(await registerShellWorker(win, production)).toBe(null);

        expect(win.container.register).not.toHaveBeenCalled();
        expect(win.container.getRegistration).toHaveBeenCalledWith('/');
        expect(existing.unregister).toHaveBeenCalledTimes(1);
        expect([...win.held]).toEqual([]);
    });

    it('leaves another worker registered for the site alone', async () => {
        const win = withdrawn(fakeWindow());
        const other = { active: { scriptURL: `${ORIGIN}/firebase-messaging-sw.js` }, unregister: vi.fn() };
        win.container.getRegistration = vi.fn().mockResolvedValue(other);

        await registerShellWorker(win, production);
        expect(other.unregister).not.toHaveBeenCalled();
    });

    it('registers as usual when the question cannot be asked, as with no network', async () => {
        const win = fakeWindow();
        win.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await registerShellWorker(win, production);
        expect(win.container.register).toHaveBeenCalledTimes(1);
    });
});

describe('main.js', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');

    it('registers the app shell\'s worker once the page has loaded', () => {
        expect(main).toMatch(/window\.addEventListener\('load', \(\) => registerShellWorker\(\)/);
    });

    it('registers the push worker under the push scope, since the root scope holds one worker only', () => {
        const calls = [...main.matchAll(/serviceWorker\.register\(([^)]*)\)/g)].map((match) => match[1]);
        expect(calls).toEqual(["'/firebase-messaging-sw.js', { scope: PUSH_WORKER_SCOPE }"]);
        expect(main).toContain("const PUSH_WORKER_SCOPE = '/firebase-cloud-messaging-push-scope';");
    });
});

describe('a new build arriving in an open tab', () => {
    const arrive = async (win, worker) => {
        win.registration.installing = worker;
        await win.registration.emit('updatefound');
        worker.state = 'installed';
        win.registration.waiting = worker;
        await worker.emit('statechange');
        await flushPromises();
    };

    it('shows the prompt in a tab still on the earlier build, and moves nothing until it is accepted', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        const next = fakeWorker(['/js/app.22222222.js']);
        await registerShellWorker(win, production);
        await arrive(win, next);

        expect(updateReady.value).toBe(true);
        expect(next.posted).not.toContain(MESSAGE.ACTIVATE);
        expect(win.location.reload).not.toHaveBeenCalled();
    });

    it('on Reload lets the new worker in and reloads once it has taken over', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        const next = fakeWorker(['/js/app.22222222.js']);
        await registerShellWorker(win, production);
        await arrive(win, next);

        applyUpdate(win);
        expect(next.posted).toContain(MESSAGE.ACTIVATE);
        expect(win.location.reload).not.toHaveBeenCalled();

        win.container.controller = next;
        await win.container.emit('controllerchange');
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });

    it('lets the new worker in without asking when the tab already runs its build', async () => {
        const win = fakeWindow({ scripts: ['/js/app.22222222.js'], controller: fakeWorker(['/js/app.11111111.js']) });
        const next = fakeWorker(['/index.html', '/js/app.22222222.js']);
        win.registration.waiting = next;
        await registerShellWorker(win, production);
        await flushPromises();

        expect(next.posted).toContain(MESSAGE.ACTIVATE);
        expect(updateReady.value).toBe(false);

        win.container.controller = next;
        await win.container.emit('controllerchange');
        expect(win.location.reload).not.toHaveBeenCalled();
    });

    it('notices a worker that began installing before the registration call returned', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        const next = fakeWorker(['/js/app.22222222.js']);
        win.registration.installing = next;
        await registerShellWorker(win, production);

        next.state = 'installed';
        win.registration.waiting = next;
        await next.emit('statechange');
        await flushPromises();

        expect(updateReady.value).toBe(true);
    });

    it('does not reload a tab when another tab accepted; it shows the prompt there', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        await registerShellWorker(win, production);

        win.container.controller = fakeWorker(['/js/app.22222222.js']);
        await win.container.emit('controllerchange');

        expect(win.location.reload).not.toHaveBeenCalled();
        expect(updateReady.value).toBe(true);
    });

    it('says nothing on the first install of a device', async () => {
        const win = fakeWindow({ controller: null });
        const first = fakeWorker(['/js/app.11111111.js']);
        await registerShellWorker(win, production);
        await arrive(win, first);

        expect(updateReady.value).toBe(false);
        expect(first.posted).toEqual([]);
    });

    it('stays quiet when the worker that took over does not answer, as the withdrawal worker does not', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        await registerShellWorker(win, production);

        win.container.controller = fakeWorker(null);
        await win.container.emit('controllerchange');

        expect(updateReady.value).toBe(false);
        expect(win.location.reload).not.toHaveBeenCalled();
    });

    it('reloads straight away on Reload when no worker is waiting', async () => {
        const win = fakeWindow({ controller: fakeWorker(['/js/app.11111111.js']) });
        await registerShellWorker(win, production);
        applyUpdate(win);
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });
});

describe('signing out or changing workspace', () => {
    it('tells the worker to drop its runtime caches and removes them from the page as well', async () => {
        const controller = fakeWorker(['/js/app.11111111.js']);
        const win = fakeWindow({ controller, cacheNames: ['ah-shell-build-1', 'ah-runtime-v1', 'anything-else'] });

        dropWorkerRuntimeCaches(win);
        await flushPromises();

        expect(controller.posted).toEqual([MESSAGE.DROP_RUNTIME_CACHES]);
        expect([...win.held]).toEqual(['ah-shell-build-1']);
    });

    it('reaches the active worker of a tab that is not controlled yet', async () => {
        const win = fakeWindow({ controller: null });
        const active = fakeWorker(['/js/app.11111111.js']);
        win.registration.active = active;
        await registerShellWorker(win, production);

        dropWorkerRuntimeCaches(win);
        expect(active.posted).toEqual([MESSAGE.DROP_RUNTIME_CACHES]);
    });

    it('never throws in a browser without workers or caches', () => {
        expect(() => dropWorkerRuntimeCaches({ navigator: {} })).not.toThrow();
        expect(() => dropWorkerRuntimeCaches({})).not.toThrow();
    });

    const source = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('is wired into sign-out, before the page reloads, and into the workspace switch', () => {
        const signOut = /const removeLocalValue = [\s\S]*?\n {4}};/.exec(source('services/index.js'))[0];
        expect(signOut.indexOf('dropWorkerRuntimeCaches()')).toBeGreaterThan(-1);
        expect(signOut.indexOf('dropWorkerRuntimeCaches()')).toBeLessThan(signOut.indexOf('window.location.reload()'));

        const switchWorkspace = /async function changeCompany\(cid\) \{[\s\S]*?\n}/.exec(source('App.vue'))[0];
        expect(switchWorkspace).toContain('dropWorkerRuntimeCaches()');
    });
});
