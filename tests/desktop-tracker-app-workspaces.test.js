const path = require('path');
const { switchWorkspace } = require('../time-tracker-app/renderer/utils/workspaceSwitch');
const { stashSession, restoreSession, forgetSession } = require('../time-tracker-app/renderer/utils/workspaceSession');
const workspaces = require('../time-tracker-app/main/helpers/workspaceState');
const deepLinks = require('../time-tracker-app/main/helpers/deepLink');
const legacy = require('../time-tracker-app/main/helpers/legacyInstall');
const { channelOf, feedUrlFor } = require('../time-tracker-app/main/helpers/updates');

const ACME = 'https://acme.alianhub.com';
const BETA = 'https://beta.example.com';

const memoryStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
};

describe('switching workspace', () => {
    const setup = ({ isTracking = false, confirm = true, queue = [[0]] } = {}) => {
        const calls = [];
        const remaining = [...queue];
        const storage = memoryStorage({ token: 'acme-token', refreshToken: 'acme-refresh', userId: 'u1', companyId: 'c1', [`workspaceSession:${BETA}`]: JSON.stringify({ token: 'beta-token', userId: 'u9' }) });
        const deps = {
            target: BETA,
            current: ACME,
            isTracking,
            storage,
            confirmStop: jest.fn(async () => { calls.push('confirm'); return confirm; }),
            stopTimer: jest.fn(async () => { calls.push('stop'); }),
            drainQueue: jest.fn(async () => { calls.push('drain'); return { remaining: (remaining.shift() || [0])[0] }; }),
            activate: jest.fn(async () => { calls.push('activate'); }),
        };
        return { deps, calls, storage };
    };

    it('stops a running timer after the person confirms, then moves', async () => {
        const { deps, calls } = setup({ isTracking: true });
        await expect(switchWorkspace(deps)).resolves.toEqual({ switched: true, stopped: true });
        expect(calls).toEqual(['confirm', 'drain', 'stop', 'drain', 'activate']);
    });

    it('keeps the timer running and stays when the person says no', async () => {
        const { deps, calls } = setup({ isTracking: true, confirm: false });
        await expect(switchWorkspace(deps)).resolves.toEqual({ switched: false, reason: 'cancelled' });
        expect(calls).toEqual(['confirm']);
        expect(deps.stopTimer).not.toHaveBeenCalled();
    });

    it('asks nothing when no timer runs', async () => {
        const { deps, calls } = setup();
        await expect(switchWorkspace(deps)).resolves.toEqual({ switched: true, stopped: false });
        expect(calls).toEqual(['drain', 'activate']);
    });

    it('stays, with the timer still running, while earlier time is unsent', async () => {
        const { deps, calls } = setup({ isTracking: true, queue: [[2]] });
        await expect(switchWorkspace(deps)).resolves.toEqual({ switched: false, reason: 'unsynced' });
        expect(calls).toEqual(['confirm', 'drain']);
        expect(deps.activate).not.toHaveBeenCalled();
    });

    it('stays when the stop itself could not be sent, so it reaches the right workspace later', async () => {
        const { deps } = setup({ isTracking: true, queue: [[0], [1]] });
        await expect(switchWorkspace(deps)).resolves.toEqual({ switched: false, reason: 'unsynced', stopped: true });
        expect(deps.activate).not.toHaveBeenCalled();
    });

    it('sets the sign-in of the workspace left aside and puts back the one switched to', async () => {
        const { deps, storage } = setup();
        await switchWorkspace(deps);
        expect(JSON.parse(storage.getItem(`workspaceSession:${ACME}`))).toEqual({ token: 'acme-token', refreshToken: 'acme-refresh', userId: 'u1', companyId: 'c1' });
        expect(storage.getItem('token')).toBe('beta-token');
        expect(storage.getItem('userId')).toBe('u9');
        expect(storage.getItem('refreshToken')).toBeNull();
        expect(storage.getItem('companyId')).toBeNull();
    });

    it('puts the sign-in back when the move fails', async () => {
        const { deps, storage } = setup();
        deps.activate.mockRejectedValue(new Error('store locked'));
        await expect(switchWorkspace(deps)).rejects.toThrow('store locked');
        expect(storage.getItem('token')).toBe('acme-token');
    });

    it('adopts the sign-in already in place when there was no workspace before', async () => {
        const { deps, storage } = setup();
        await switchWorkspace({ ...deps, current: null });
        expect(storage.getItem('token')).toBe('acme-token');
    });

    it('does nothing for the workspace already in use', async () => {
        const { deps } = setup({ isTracking: true });
        await expect(switchWorkspace({ ...deps, target: ACME })).resolves.toEqual({ switched: false, reason: 'same' });
        expect(deps.confirmStop).not.toHaveBeenCalled();
    });

    it('stashes nothing for a workspace that was signed out', () => {
        const storage = memoryStorage({ [`workspaceSession:${ACME}`]: '{"token":"old"}' });
        stashSession(storage, ACME);
        expect(storage.getItem(`workspaceSession:${ACME}`)).toBeNull();
        storage.setItem(`workspaceSession:${BETA}`, 'not json');
        storage.setItem('token', 'x');
        restoreSession(storage, BETA);
        expect(storage.getItem('token')).toBeNull();
        forgetSession(storage, BETA);
        expect(storage.getItem(`workspaceSession:${BETA}`)).toBeNull();
    });
});

describe('the workspace list the main process keeps', () => {
    it('adds a workspace and makes it current', () => {
        const state = workspaces.addWorkspace(workspaces.emptyState(), { url: ACME, name: 'Acme', logoUrl: '/logo' }, 100);
        expect(state).toEqual({ workspaces: [{ url: ACME, name: 'Acme', logoUrl: '/logo', lastUsedAt: 100 }], current: ACME });
    });

    it('adds a second one without losing the first, and switches between them', () => {
        let state = workspaces.addWorkspace(workspaces.emptyState(), { url: ACME, name: 'Acme' }, 100);
        state = workspaces.addWorkspace(state, { url: BETA, name: 'Beta' }, 200);
        expect(state.workspaces.map((w) => w.url)).toEqual([ACME, BETA]);
        expect(state.current).toBe(BETA);
        state = workspaces.selectWorkspace(state, ACME, 300);
        expect(state.current).toBe(ACME);
        expect(state.workspaces[0].lastUsedAt).toBe(300);
        expect(workspaces.selectWorkspace(state, 'https://unknown.example.com', 400).current).toBe(ACME);
    });

    it('keeps one entry per address and its name when connected again without one', () => {
        let state = workspaces.addWorkspace(workspaces.emptyState(), { url: ACME, name: 'Acme' }, 100);
        state = workspaces.addWorkspace(state, { url: ACME }, 200);
        expect(state.workspaces).toEqual([{ url: ACME, name: 'Acme', logoUrl: '', lastUsedAt: 200 }]);
    });

    it('updates the name and logo the handshake reports', () => {
        const state = workspaces.updateWorkspace(workspaces.addWorkspace(workspaces.emptyState(), { url: ACME }, 100), ACME, { name: 'Acme', logoUrl: '/logo', url: 'https://evil.example.com' });
        expect(state.workspaces).toEqual([{ url: ACME, name: 'Acme', logoUrl: '/logo', lastUsedAt: 100 }]);
    });

    it('removes another workspace but never the one in use', () => {
        let state = workspaces.addWorkspace(workspaces.emptyState(), { url: ACME }, 100);
        state = workspaces.addWorkspace(state, { url: BETA }, 200);
        expect(state.current).toBe(BETA);
        expect(workspaces.removeWorkspace(state, ACME)).toEqual({ workspaces: [{ url: BETA, name: '', logoUrl: '', lastUsedAt: 200 }], current: BETA });
        expect(workspaces.removeWorkspace(state, BETA).workspaces.map((w) => w.url)).toEqual([ACME, BETA]);
    });

    it('starts an upgraded tracker on the address its old build had, once', () => {
        const seeded = workspaces.seedWorkspace(workspaces.emptyState(), 'https://hub.example.com', 100);
        expect(seeded).toEqual({ workspaces: [{ url: 'https://hub.example.com', name: '', logoUrl: '', lastUsedAt: 100 }], current: 'https://hub.example.com' });
        expect(workspaces.seedWorkspace(seeded, 'https://other.example.com', 200)).toEqual(seeded);
        expect(workspaces.seedWorkspace(workspaces.emptyState(), '', 100)).toEqual(workspaces.emptyState());
    });

    it('reads a damaged store as empty instead of failing', () => {
        expect(workspaces.normaliseState(undefined)).toEqual(workspaces.emptyState());
        expect(workspaces.normaliseState({ workspaces: [null, { url: 3 }, { url: ACME }, { url: ACME }], current: BETA })).toEqual({ workspaces: [{ url: ACME, name: '', logoUrl: '', lastUsedAt: 0 }], current: null });
    });
});

describe('links the tracker opens', () => {
    it('routes "Open in tracker" to connect, with the workspace address', () => {
        const link = `alianhub-tracker://connect?url=${encodeURIComponent(ACME)}`;
        expect(deepLinks.deepLinkKind(link)).toBe('connect');
        expect(deepLinks.connectTarget(link)).toBe(ACME);
    });

    it('routes a task start and a sign-in on either scheme', () => {
        expect(deepLinks.deepLinkKind('myapp://open?type=trackerStart&taskId=t1')).toBe('trackerStart');
        expect(deepLinks.deepLinkKind('alianhub-tracker://open?taskId=t1&type=trackerStart')).toBe('trackerStart');
        expect(deepLinks.deepLinkKind('myapp://authorize?client_id=u1&code=c')).toBe('authorize');
        expect(deepLinks.deepLinkKind('alianhub-tracker://authorize?client_id=u1&code=c')).toBe('authorize');
    });

    it('ignores anything that is not a tracker link', () => {
        expect(deepLinks.deepLinkKind('https://acme.alianhub.com')).toBeNull();
        expect(deepLinks.connectTarget('alianhub-tracker://authorize?url=x')).toBe('');
        expect(deepLinks.findTrackerLink(['/opt/AlianHub Tracker/alianhub-tracker', '--no-sandbox', 'alianhub-tracker://connect?url=x'])).toBe('alianhub-tracker://connect?url=x');
        expect(deepLinks.findTrackerLink(['C:\\Program Files\\AlianHub Tracker\\alianhub-tracker.exe', '.'])).toBeNull();
    });
});

describe('upgrading from a tracker with its server baked in', () => {
    const nextData = (runtimeConfig) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: {}, page: '/home', runtimeConfig })}</script></body></html>`;

    it('reads the address the old build shipped with', () => {
        expect(legacy.extractLegacyApiUrl(nextData({ APIURL: 'https://hub.example.com/' }))).toBe('https://hub.example.com');
        expect(legacy.extractLegacyApiUrl(nextData({ APIURL: 'http://192.168.1.10:4000' }))).toBe('http://192.168.1.10:4000');
        expect(legacy.extractLegacyApiUrl('self.__next_f.push({"APIURL":"https://other.example.com"})')).toBe('https://other.example.com');
    });

    it('finds nothing in a page without one', () => {
        expect(legacy.extractLegacyApiUrl(nextData({}))).toBeNull();
        expect(legacy.extractLegacyApiUrl(nextData({ APIURL: 'undefined' }))).toBeNull();
        expect(legacy.extractLegacyApiUrl('')).toBeNull();
    });

    it('looks where tracker 5 installed itself on each system', () => {
        const win = legacy.legacyAsarCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' } });
        expect(win).toContain(path.join('C:\\Users\\a\\AppData\\Local', 'Programs', 'alianhubtimetracker', 'resources', 'app.asar'));
        const mac = legacy.legacyAsarCandidates({ platform: 'darwin', home: '/Users/a' });
        expect(mac).toContain(path.join('/Applications', 'Alian Hub Time Tracker 2.0.app', 'Contents', 'Resources', 'app.asar'));
        expect(legacy.legacyAsarCandidates({ platform: 'linux' })).toContain(path.join('/opt', 'Alian Hub Time Tracker 2.0', 'resources', 'app.asar'));
    });

    it('takes the first install whose pages name a server', () => {
        const pages = { [path.join('/b/app.asar', 'app/login/index.html')]: nextData({ APIURL: 'https://hub.example.com' }) };
        const readFile = (file) => { if (!(file in pages)) throw new Error('ENOENT'); return pages[file]; };
        expect(legacy.findLegacyApiUrl({ candidates: ['/a/app.asar', '/b/app.asar'], readFile })).toBe('https://hub.example.com');
        expect(legacy.findLegacyApiUrl({ candidates: ['/a/app.asar'], readFile })).toBeNull();
    });

    it('carries the old sign-in into a profile that was never used, and never over one that was', () => {
        const appData = path.join('/data');
        const userData = path.join(appData, 'AlianHub Tracker');
        const old = path.join(appData, 'Alian Hub Time Tracker 2.0');
        const existing = new Set([path.join(old, 'Local Storage'), path.join(old, 'IndexedDB')]);
        const copied = [];
        const fs = { existsSync: (p) => existing.has(p), cpSync: (from, to) => copied.push([from, to]) };
        expect(legacy.copyLegacySession({ appData, userData, fs })).toBe(old);
        expect(copied).toEqual([
            [path.join(old, 'Local Storage'), path.join(userData, 'Local Storage')],
            [path.join(old, 'IndexedDB'), path.join(userData, 'IndexedDB')],
        ]);
        existing.add(path.join(userData, 'Local Storage'));
        expect(legacy.copyLegacySession({ appData, userData, fs })).toBeNull();
    });
});

describe('the update channel', () => {
    it('follows stable from a release build and beta from a beta build', () => {
        expect(channelOf('6.0.0')).toBe('stable');
        expect(channelOf('6.1.0-beta.2')).toBe('beta');
        expect(feedUrlFor('6.0.0')).toBe('https://downloads.alianhub.com/tracker/stable/');
        expect(feedUrlFor('6.1.0-beta.2', 'https://files.example.test/tracker/')).toBe('https://files.example.test/tracker/beta/');
    });
});
