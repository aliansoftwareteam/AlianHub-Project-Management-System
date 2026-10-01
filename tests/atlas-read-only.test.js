const { decide, ALLOWED_READS } = require('../scripts/atlas/readOnly');
const { createReader, pickProject } = require('../scripts/atlas/params');

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

    test('a path that reads or writes by its body passes only for the reading body', () => {
        const relations = (body) => decide({ method: 'POST', url: `${BASE}/api/v2/tasks/relations`, body }, { baseUrl: BASE });
        expect(relations({ action: 'list', taskId: 't1' }).allow).toBe(true);
        expect(relations({ action: 'add', taskId: 't1' })).toEqual({ allow: false, reason: 'POST /api/v2/tasks/relations with this body is not a read' });
        expect(relations({ action: 'remove' }).allow).toBe(false);
        expect(relations(null).allow).toBe(false);
        expect(relations(undefined).allow).toBe(false);
    });

    test('a path that creates on a first visit stays blocked', () => {
        expect(verdict('POST', `${BASE}/api/v1/project/personal`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/ai/task-summary`)).toBe(false);
        expect(verdict('POST', `${BASE}/api/v1/updateTaskIndexOnload`)).toBe(false);
        expect(verdict('PUT', `${BASE}/api/v2/session/update`)).toBe(false);
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

describe('atlas lookups', () => {
    const answer = (body) => ({ ok: true, status: 200, json: async () => body });

    test('the script\'s own lookups cannot write either', async () => {
        const fetchImpl = jest.fn();
        const read = createReader({ baseUrl: BASE, token: 't', companyId: 'c1', fetchImpl });
        await expect(read('POST', '/api/v2/tasks', { data: {} })).rejects.toThrow('not on the read list');
        await expect(read('DELETE', '/api/v1/project/p1')).rejects.toThrow('not on the read list');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('a lookup sends the session and the workspace, and nothing in the address', async () => {
        const fetchImpl = jest.fn(async () => answer([{ _id: 'p1' }]));
        const read = createReader({ baseUrl: BASE, token: 'secret-token', companyId: 'c1', fetchImpl });
        await expect(read('GET', '/api/v1/project')).resolves.toEqual([{ _id: 'p1' }]);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe(`${BASE}/api/v1/project`);
        expect(options.headers).toMatchObject({ authorization: 'Bearer secret-token', companyid: 'c1' });
    });

    test('a failed lookup names the path and the status, not the token', async () => {
        const read = createReader({ baseUrl: BASE, token: 'secret-token', fetchImpl: async () => ({ ok: false, status: 401 }) });
        await expect(read('GET', '/api/v1/project')).rejects.toThrow('GET /api/v1/project answered 401');
    });

    const projects = [
        { _id: 'b', ProjectName: 'Two views', ProjectCode: 'TWO', ProjectRequiredComponent: [{}, {}] },
        { _id: 'c', ProjectName: 'Four views', ProjectCode: 'FOUR', ProjectRequiredComponent: [{}, {}, {}, {}] },
        { _id: 'a', ProjectName: 'Also four', ProjectCode: 'ALSO', ProjectRequiredComponent: [{}, {}, {}, {}] },
        { _id: 'd', ProjectName: 'Deleted', ProjectCode: 'DEL', deletedStatusKey: 1, ProjectRequiredComponent: [{}, {}, {}, {}, {}] },
    ];

    test('the project with the most views is opened, and the same one every run', () => {
        expect(pickProject(projects)._id).toBe('a');
        expect(pickProject([...projects].reverse())._id).toBe('a');
        expect(pickProject([])).toBeNull();
    });

    test('--project takes an id, a key or a name', () => {
        expect(pickProject(projects, 'b')._id).toBe('b');
        expect(pickProject(projects, 'four')._id).toBe('c');
        expect(pickProject(projects, 'Two views')._id).toBe('b');
        expect(() => pickProject(projects, 'nope')).toThrow('--project');
    });
});
