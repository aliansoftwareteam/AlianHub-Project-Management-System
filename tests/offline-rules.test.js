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

describe('queued write descriptions and conflicts', () => {
    const taskPut = (fields, at = 1000) => ({
        id: 1, at, type: 'put', endPoint: '/api/v1/task',
        data: { firstParameter: { objId: { _id: '6a350f0a383f83342195a939' } }, secondParameter: { $set: fields }, key: 'updateOne' },
    });
    test('taskWriteOf reads the task id and the $set fields', () => {
        expect(R.taskWriteOf(taskPut({ statusKey: 'review' }))).toEqual({ taskId: '6a350f0a383f83342195a939', fields: { statusKey: 'review' } });
        expect(R.taskWriteOf({ type: 'post', endPoint: '/api/v1/comments', data: {} })).toBeNull();
    });
    test('describeQueuedWrite labels status, comment and time rows', () => {
        expect(R.describeQueuedWrite(taskPut({ statusKey: 'In review' })).tag).toBe('STATUS');
        expect(R.describeQueuedWrite({ type: 'post', endPoint: '/api/v1/comments', data: { data: { message: 'vendor wants a <b>signed</b> DPA' } } }))
            .toEqual({ tag: 'COMMENT', text: '"vendor wants a signed DPA"', taskId: '' });
        expect(R.describeQueuedWrite({ type: 'post', endPoint: '/api/v2/manualLogtime', data: { timeDuration: '01:12', taskName: 'AHE-298', ticketId: 'x' } }))
            .toEqual({ tag: 'TIME', text: '01:12 on AHE-298', taskId: 'x' });
    });
    test('findConflicts only flags fields the server moved after the queue time', () => {
        const write = R.taskWriteOf(taskPut({ statusKey: 'review' }, 1000));
        expect(R.findConflicts(write, { statusKey: 'blocked', updatedAt: new Date(2000) }, 1000)).toEqual([{ field: 'statusKey', mine: 'review', theirs: 'blocked' }]);
        expect(R.findConflicts(write, { statusKey: 'blocked', updatedAt: new Date(500) }, 1000)).toEqual([]);
        expect(R.findConflicts(write, { statusKey: 'review', updatedAt: new Date(2000) }, 1000)).toEqual([]);
    });
});
