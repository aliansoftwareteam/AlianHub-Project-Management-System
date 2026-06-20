const R = require('../frontend/src/offline/offlineRules');

describe('isCacheableGet', () => {
    test('caches whitelisted GET reads', () => {
        expect(R.isCacheableGet('get', '/api/v1/project')).toBe(true);
        expect(R.isCacheableGet('get', '/api/v1/project?skip=0&limit=20')).toBe(true);
        expect(R.isCacheableGet('get', '/api/v1/project/6a350f0a383f83342195a939')).toBe(true);
        expect(R.isCacheableGet('get', '/api/v1/projectdata/taskData?pid=1')).toBe(true);
        expect(R.isCacheableGet('get', '/api/v2/tasks')).toBe(true);
        expect(R.isCacheableGet('get', '/api/v1/task/6a350f0a383f83342195a939')).toBe(true);
    });
    test('ignores non-GET and non-whitelisted', () => {
        expect(R.isCacheableGet('post', '/api/v1/project')).toBe(false);
        expect(R.isCacheableGet('get', '/api/v1/members')).toBe(false);
        expect(R.isCacheableGet('get', '/api/v2/sso/config')).toBe(false);
    });
});

describe('isQueueableWrite', () => {
    test('queues the whitelisted offline edits', () => {
        expect(R.isQueueableWrite('put', '/api/v1/task')).toBe(true);
        expect(R.isQueueableWrite('patch', '/api/v2/tasks')).toBe(true);
        expect(R.isQueueableWrite('post', '/api/v1/comments')).toBe(true);
        expect(R.isQueueableWrite('post', '/api/v2/manualLogtime')).toBe(true);
    });
    test('does NOT queue other writes (e.g. deletes, members, sso)', () => {
        expect(R.isQueueableWrite('delete', '/api/v1/task/filter/delete/c/i')).toBe(false);
        expect(R.isQueueableWrite('post', '/api/v1/members')).toBe(false);
        expect(R.isQueueableWrite('put', '/api/v2/sso/config')).toBe(false);
        expect(R.isQueueableWrite('get', '/api/v1/comments')).toBe(false);
    });
});

describe('isOfflineError', () => {
    test('true for a no-response network error', () => {
        expect(R.isOfflineError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true);
        expect(R.isOfflineError({ message: 'timeout', code: 'ECONNABORTED' })).toBe(true);
    });
    test('false when the server responded (real HTTP error)', () => {
        expect(R.isOfflineError({ response: { status: 403, data: {} } })).toBe(false);
    });
    test('false for canceled requests and falsy errors', () => {
        expect(R.isOfflineError({ code: 'ERR_CANCELED' })).toBe(false);
        expect(R.isOfflineError(null)).toBe(false);
        expect(R.isOfflineError(undefined)).toBe(false);
    });
});

describe('cacheKeyFor', () => {
    test('uses the endpoint path+query as the key', () => {
        expect(R.cacheKeyFor('/api/v1/project?skip=0')).toBe('/api/v1/project?skip=0');
        expect(R.cacheKeyFor(undefined)).toBe('');
    });
});

describe('synthetic responses', () => {
    test('makeCachedResponse wraps payload in an axios-shaped object', () => {
        const r = R.makeCachedResponse([{ a: 1 }]);
        expect(r.status).toBe(200);
        expect(r.data).toEqual([{ a: 1 }]);
        expect(r._offline).toBe('cache');
    });
    test('makeQueuedResponse signals a queued write', () => {
        const r = R.makeQueuedResponse({ endPoint: '/api/v1/task' });
        expect(r.status).toBe(202);
        expect(r.data.status).toBe(true);
        expect(r.data.queuedOffline).toBe(true);
        expect(r.data.endPoint).toBe('/api/v1/task');
        expect(r._offline).toBe('queued');
    });
});
