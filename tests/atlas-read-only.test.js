const { decide, ALLOWED_READS } = require('../scripts/atlas/readOnly');

const BASE = 'http://localhost:4000';
const verdict = (method, url) => decide({ method, url }, { baseUrl: BASE }).allow;

describe('atlas read-only request filter', () => {
    test('a GET passes', () => {
        expect(verdict('GET', `${BASE}/api/v1/project`)).toBe(true);
        expect(verdict('get', `${BASE}/js/app.js`)).toBe(true);
        expect(verdict('HEAD', `${BASE}/api/v1/project`)).toBe(true);
        expect(verdict('OPTIONS', `${BASE}/api/v1/project`)).toBe(true);
    });

    test('a POST write is blocked', () => {
        expect(verdict('POST', `${BASE}/api/v2/tasks`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/dashboard`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v2/recent-visits`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v2/generateToken`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/removeCache`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/mongoOpration`)).toBe(false);
    });

    test('PUT, PATCH and DELETE are blocked everywhere, even on a path whose POST is a read', () => {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            expect(verdict(method, `${BASE}/api/v1/user`)).toBe(false);
            expect(verdict(method, `${BASE}/api/v1/task/find`)).toBe(false);
        }
    });

    test('a POST the app loads its data with passes', () => {
        expect(verdict('POST', `${BASE}/api/v1/task/find`)).toBe(true);
        expect(verdict('POST', `${BASE}/api/v1/task/find?x=1`)).toBe(true);
    });

    test('a look-alike path does not pass', () => {
        expect(verdict('POST', `${BASE}/api/v1/task/findAndUpdate`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/task/find/../../v2/tasks`)).toBe(false);
        expect(verdict('POST', `${BASE}/x/api/v1/task/find`)).toBe(false);
    });

    test('a POST to any other host is blocked', () => {
        expect(verdict('POST', 'https://example.com/api/v1/task/find')).toBe(false);
        expect(verdict('POST', 'http://localhost:4001/api/v1/task/find')).toBe(false);
    });

    test('an unreadable request is blocked rather than waved through', () => {
        expect(verdict('POST', 'not a url')).toBe(false);
        expect(verdict(undefined, `${BASE}/api/v1/task/find`)).toBe(false);
    });

    test('a blocked request says why', () => {
        expect(decide({ method: 'POST', url: `${BASE}/api/v2/tasks` }, { baseUrl: BASE })).toEqual({ allow: false, reason: 'POST /api/v2/tasks is not on the read list' });
    });

    test('every allowed non-GET says why it is a read', () => {
        expect(ALLOWED_READS.length).toBeGreaterThan(0);
        for (const entry of ALLOWED_READS) {
            expect(entry.method).toBe('POST');
            expect(entry.path.startsWith('/')).toBe(true);
            expect(entry.why.length).toBeGreaterThan(10);
        }
        const keys = ALLOWED_READS.map((entry) => `${entry.method} ${entry.path}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
