import { ref } from 'vue';
import rules from './rules';
import { STEP, isPageCurrent, pageScriptPaths, updateStep, controllerChangeStep, shouldCheckForUpdate } from './updateRules';

const { MESSAGE, WORKER_PATH, WITHDRAWN_HEADER, WITHDRAWN_VALUE, isShellCache } = rules;
const DESCRIBE_TIMEOUT_MS = 3000;

export const updateReady = ref(false);

let registration = null;
let accepted = false;
let lastCheckedAt = 0;

/* The desktop app loads its own bundled pages; a worker there would hold a second copy of the app
 * that its updater knows nothing about. */
export const isDesktopShell = (userAgent) => /\belectron\//i.test(String(userAgent || ''));

export const shouldRegister = ({ production, supported, secure, userAgent }) => Boolean(production && supported && secure && !isDesktopShell(userAgent));

const describe = (worker, win) => new Promise((resolve) => {
    const channel = new win.MessageChannel();
    const timer = win.setTimeout(() => resolve(null), DESCRIBE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
        win.clearTimeout(timer);
        resolve(event.data || null);
    };
    worker.postMessage({ type: MESSAGE.DESCRIBE }, [channel.port2]);
});

const pageCurrentFor = async (worker, win) => {
    const described = await describe(worker, win);
    return isPageCurrent(pageScriptPaths([...win.document.scripts], win.location.origin), described && described.assets);
};

const onWaiting = async (worker, win) => {
    const step = updateStep({ waiting: true, pageCurrent: await pageCurrentFor(worker, win) });
    if (step === STEP.ACTIVATE) worker.postMessage({ type: MESSAGE.ACTIVATE });
    else updateReady.value = true;
};

const watchForWaiting = (container, win) => {
    const follow = (installing) => {
        if (!installing) return;
        installing.addEventListener('statechange', () => {
            // With no controller the installing worker is this device's first; it replaces nothing.
            if (installing.state === 'installed' && container.controller) onWaiting(installing, win);
        });
    };
    if (registration.waiting && container.controller) onWaiting(registration.waiting, win);
    // register() itself starts the check, so the new worker may be installing before anyone listens for updatefound.
    follow(registration.installing);
    registration.addEventListener('updatefound', () => follow(registration.installing));
};

const watchForTakeover = (container, win) => {
    container.addEventListener('controllerchange', async () => {
        const controller = container.controller;
        const pageCurrent = accepted || !controller ? null : await pageCurrentFor(controller, win);
        const step = controllerChangeStep({ accepted, pageCurrent });
        if (step === STEP.RELOAD) win.location.reload();
        else if (step === STEP.PROMPT) updateReady.value = true;
    });
};

/* A tab that stays open never navigates, and a browser looks for a new worker on navigation. */
const checkWhenLookedAt = (win) => {
    win.document.addEventListener('visibilitychange', () => {
        const due = shouldCheckForUpdate({
            now: Date.now(),
            lastCheckedAt,
            visible: win.document.visibilityState === 'visible',
            online: win.navigator.onLine !== false,
        });
        if (!due) return;
        lastCheckedAt = Date.now();
        registration.update().catch(() => {});
    });
};

const isWithdrawn = async (win) => {
    try {
        const answer = await win.fetch(WORKER_PATH, { method: 'HEAD', cache: 'no-store' });
        return answer.headers.get(WITHDRAWN_HEADER) === WITHDRAWN_VALUE;
    } catch {
        return false;
    }
};

const isShellRegistration = (found, win) => [found.active, found.waiting, found.installing]
    .some((worker) => worker && new URL(worker.scriptURL, win.location.origin).pathname === WORKER_PATH);

/* The server also answers /sw.js with a worker that removes itself, which the browser installs on its
 * own. Registering here again would bring the registration straight back, so the page stays out and
 * removes what it can reach. */
const withdraw = async (container, win) => {
    const found = await container.getRegistration('/');
    if (found && isShellRegistration(found, win)) await found.unregister();
    if (win.caches) await Promise.all((await win.caches.keys()).map((name) => win.caches.delete(name)));
};

export const registerShellWorker = async (win = window, { production = process.env.NODE_ENV === 'production' } = {}) => {
    const container = win.navigator.serviceWorker;
    if (!shouldRegister({ production, supported: Boolean(container), secure: win.isSecureContext, userAgent: win.navigator.userAgent })) return null;
    if (await isWithdrawn(win)) {
        await withdraw(container, win).catch(() => {});
        return null;
    }
    try {
        registration = await container.register(WORKER_PATH, { scope: '/', updateViaCache: 'none' });
    } catch (error) {
        console.warn('[app shell] the worker was not registered:', error && error.message);
        return null;
    }
    // A browser set to block workers may resolve with nothing.
    if (!registration) return null;
    lastCheckedAt = Date.now();
    watchForWaiting(container, win);
    watchForTakeover(container, win);
    checkWhenLookedAt(win);
    return registration;
};

export const applyUpdate = (win = window) => {
    accepted = true;
    const waiting = registration && registration.waiting;
    // An uncontrolled tab hears no controllerchange, so it reloads itself.
    if (waiting && win.navigator.serviceWorker.controller) waiting.postMessage({ type: MESSAGE.ACTIVATE });
    else win.location.reload();
};

/* Called on sign-out and on a workspace switch. The worker is told, and the page removes the same
 * caches itself, because sign-out reloads the page straight after and either may be cut short. */
export const dropWorkerRuntimeCaches = (win = window) => {
    try {
        const container = win.navigator && win.navigator.serviceWorker;
        const worker = container && (container.controller || (registration && registration.active));
        if (worker) worker.postMessage({ type: MESSAGE.DROP_RUNTIME_CACHES });
        if (win.caches) {
            win.caches.keys()
                .then((names) => Promise.all(names.filter((name) => !isShellCache(name)).map((name) => win.caches.delete(name))))
                .catch(() => {});
        }
    } catch (error) {
        console.warn('[app shell] runtime caches were not dropped:', error && error.message);
    }
};

export const resetShellWorkerState = () => {
    registration = null;
    accepted = false;
    lastCheckedAt = 0;
    updateReady.value = false;
};
