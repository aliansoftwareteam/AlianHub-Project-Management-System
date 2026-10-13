const { AUTH, classifyAuth, groupRoutes, metaShapeProblems, metaDrift, driftReport, renderRoute, renderAppendix, openApiOf, staleFiles } = require('../scripts/api-doc');

const context = {
    held: [
        { methods: ['POST'], path: /^\/api\/v2\/tasks\/everything\/?$/i },
        { methods: ['GET'], path: /^\/api\/v1\/task\/[a-f0-9]{24}\/?$/i },
    ],
    tokenBlockedPrefix: '/api/v2/api-tokens',
    tokenAllowedPaths: ['/api/v2/api-tokens/me'],
};

const route = (key, extra = {}) => {
    const [method, path] = key.split(' ');
    return { key, method, path, guard: 'company', ownAuth: null, permissions: [], taskNeeds: null, actions: null, source: 'Modules/Sample/init', ...extra };
};

describe('auth classification', () => {
    it('reads a route behind no guard as public', () => {
        expect(classifyAuth(route('POST /api/v2/auth/login', { guard: null }), {}, context)).toEqual({
            class: AUTH.PUBLIC, token: false, narrowedToken: false, scope: null, companyHeader: 'none',
        });
    });

    it('lets a token through the company guard with the scope its method needs', () => {
        expect(classifyAuth(route('GET /api/v2/pages'), {}, context)).toMatchObject({ class: AUTH.SESSION_OR_TOKEN, token: true, scope: 'read', companyHeader: 'required' });
        expect(classifyAuth(route('POST /api/v2/pages'), {}, context)).toMatchObject({ class: AUTH.SESSION_OR_TOKEN, token: true, scope: 'write' });
        expect(classifyAuth(route('DELETE /api/v2/pages/:id'), {}, context)).toMatchObject({ scope: 'write' });
    });

    it('asks a token for the company header on a route a session reaches without one', () => {
        expect(classifyAuth(route('GET /api/v2/users/sessions', { guard: 'user' }), {}, context)).toMatchObject({ class: AUTH.SESSION_OR_TOKEN, token: true, companyHeader: 'with-token' });
    });

    it('keeps tokens out of token management, except whoami', () => {
        expect(classifyAuth(route('POST /api/v2/api-tokens'), {}, context)).toMatchObject({ class: AUTH.SESSION, token: false, scope: null });
        expect(classifyAuth(route('GET /api/v2/api-tokens/:id/logs'), {}, context)).toMatchObject({ class: AUTH.SESSION, token: false });
        expect(classifyAuth(route('GET /api/v2/api-tokens/me'), {}, context)).toMatchObject({ class: AUTH.SESSION_OR_TOKEN, token: true, scope: 'read' });
    });

    it('takes the handler\'s own refusal of tokens from the meta file', () => {
        expect(classifyAuth(route('POST /api/v2/secrets'), { apiToken: false }, context)).toMatchObject({ class: AUTH.SESSION, token: false, narrowedToken: false });
    });

    it('holds a narrowed token to the routes that honour its project list', () => {
        expect(classifyAuth(route('POST /api/v2/tasks/everything'), {}, context).narrowedToken).toBe(true);
        expect(classifyAuth(route('GET /api/v1/task/:id'), {}, context).narrowedToken).toBe(true);
        expect(classifyAuth(route('POST /api/v2/tasks'), {}, context).narrowedToken).toBe(false);
        expect(classifyAuth(route('GET /api/v2/tasks/everything'), {}, context).narrowedToken).toBe(false);
    });

    it('reads the instance guard as session only', () => {
        expect(classifyAuth(route('GET /api/v2/instance/settings', { guard: 'instance-admin' }), {}, context)).toMatchObject({ class: AUTH.INSTANCE_ADMIN, token: false, scope: null });
    });

    it('reads a route that checks the token itself as token only', () => {
        expect(classifyAuth(route('GET /api/public-v1/tasks', { guard: null, ownAuth: 'api-token' }), {}, context)).toEqual({
            class: AUTH.API_TOKEN, token: true, narrowedToken: true, scope: 'read', companyHeader: 'required',
        });
    });
});

const meta = {
    resources: [
        { id: 'pages', title: 'Pages', intro: 'Wiki pages.' },
        { id: 'tasks', title: 'Tasks', intro: 'Tasks.' },
    ],
    routes: {
        'POST /api/v2/tasks': { resource: 'tasks', stability: 'stable', title: 'Create a task', summary: 'Creates a task.', response: { status: true } },
        'GET /api/v2/pages': { resource: 'pages', stability: 'beta', title: 'List pages', summary: 'Lists pages.', response: { status: true } },
        'POST /api/v2/pages': { resource: 'pages', stability: 'beta', title: 'Create a page', summary: 'Creates a page.', response: { status: true } },
        'GET /api/v2/secrets': { stability: 'internal', summary: 'Workspace secrets.', apiToken: false },
        'GET /api/v2/forms': { stability: 'beta', summary: 'Lists forms.' },
    },
};

const routes = [
    route('GET /api/v2/secrets'),
    route('POST /api/v2/pages'),
    route('GET /api/v2/forms'),
    route('POST /api/v2/tasks'),
    route('GET /api/v1/task/:id'),
    route('GET /api/v2/pages'),
];

describe('route grouping', () => {
    const grouped = groupRoutes(routes, meta);

    it('puts documented routes under their resource, resources and routes in the meta file\'s order', () => {
        expect(grouped.resources.map((r) => r.id)).toEqual(['pages', 'tasks']);
        expect(grouped.resources[0].routes.map((r) => r.route.key)).toEqual(['GET /api/v2/pages', 'POST /api/v2/pages']);
        expect(grouped.resources[1].routes.map((r) => r.route.key)).toEqual(['POST /api/v2/tasks']);
    });

    it('lists every other route in the appendix, sorted, as internal or undocumented; v1 is internal unless described', () => {
        expect(grouped.appendix.map((r) => [r.route.key, r.status])).toEqual([
            ['GET /api/v1/task/:id', 'internal'],
            ['GET /api/v2/forms', 'undocumented'],
            ['GET /api/v2/secrets', 'internal'],
        ]);
    });

    it('leaves out a resource no route belongs to', () => {
        expect(groupRoutes([route('GET /api/v2/pages')], meta).resources.map((r) => r.id)).toEqual(['pages']);
    });
});

describe('the meta file by itself', () => {
    it('is accepted when every entry has a valid shape', () => {
        expect(metaShapeProblems(meta)).toEqual([]);
    });

    it('refuses a file without its two parts', () => {
        expect(metaShapeProblems({ routes: {} })).toEqual(['scripts/api-doc.meta.json must hold a "resources" list and a "routes" object']);
        expect(metaShapeProblems(null)).toHaveLength(1);
    });

    it('refuses a resource with no title and one listed twice', () => {
        expect(metaShapeProblems({ resources: [{ id: 'pages', intro: 'Wiki pages.' }, ...meta.resources], routes: {} })).toEqual([
            'a resource needs an id, a title and an intro: {"id":"pages","intro":"Wiki pages."}',
            'resource listed twice: pages',
        ]);
    });

    it('refuses an unknown stability, an unknown resource and a documented route with nothing to show', () => {
        const broken = {
            resources: meta.resources,
            routes: {
                ...meta.routes,
                'GET /api/v2/forms': { stability: 'done', summary: 'Lists forms.' },
                'GET /api/v2/pages': { resource: 'wiki', stability: 'beta', title: 'List pages', summary: 'Lists pages.', response: {} },
                'POST /api/v2/pages': { resource: 'pages', stability: 'internal', title: 'Create a page', summary: 'Creates a page.', response: {} },
                'POST /api/v2/tasks': { resource: 'tasks', stability: 'stable' },
            },
        };
        expect(metaShapeProblems(broken)).toEqual([
            'unknown stability "done": GET /api/v2/forms',
            'unknown resource "wiki": GET /api/v2/pages',
            'documented in full but marked internal: POST /api/v2/pages',
            'documented in full but has no title, summary or response: POST /api/v2/tasks',
        ]);
    });

    it('refuses a key that is not a route, a body that is not a list and an action filter that is not a pattern', () => {
        const documented = { resource: 'pages', stability: 'beta', title: 'List pages', summary: 'Lists pages.', response: {} };
        expect(metaShapeProblems({
            resources: meta.resources,
            routes: {
                '/api/v2/pages': { stability: 'beta' },
                'GET /api/v2/pages': { ...documented, body: 'title' },
                'POST /api/v2/pages': { ...documented, actionsMatching: '(' },
                'PUT /api/v2/pages/:id': 'beta',
            },
        })).toEqual([
            'not a route key (METHOD /path): /api/v2/pages',
            '"body" must be a list: GET /api/v2/pages',
            '"actionsMatching" is not a pattern: POST /api/v2/pages',
            'entry is not an object: PUT /api/v2/pages/:id',
        ]);
    });

    it('does not depend on which routes exist', () => {
        const withOrphan = { ...meta, routes: { ...meta.routes, 'GET /api/v2/gone': { stability: 'beta', summary: 'Removed by another change.' } } };
        expect(metaShapeProblems(withOrphan)).toEqual([]);
    });
});

describe('routes and meta file moving apart', () => {
    const added = route('DELETE /api/v2/pages/:id');
    const withoutForms = routes.filter((r) => r.key !== 'GET /api/v2/forms');

    it('finds nothing when every v2 route is described and every entry names a route', () => {
        expect(metaDrift(routes, meta)).toEqual({ orphans: [], undescribed: [] });
    });

    it('names a v2 route with no entry, and asks for none outside v2', () => {
        expect(metaDrift([...routes, added, route('GET /api/v1/project/:id')], meta)).toEqual({ orphans: [], undescribed: ['DELETE /api/v2/pages/:id'] });
    });

    it('names an entry whose route no longer exists', () => {
        expect(metaDrift(withoutForms, meta)).toEqual({ orphans: ['GET /api/v2/forms'], undescribed: [] });
    });

    it('lists a route with no entry by rule: v2 undocumented, v1 internal', () => {
        const grouped = groupRoutes([...routes, added, route('GET /api/v1/project/:id')], meta);
        const status = Object.fromEntries(grouped.appendix.map((item) => [item.route.key, item.status]));
        expect(status['DELETE /api/v2/pages/:id']).toBe('undocumented');
        expect(status['GET /api/v1/project/:id']).toBe('internal');
    });

    it('leaves an entry with no route out of the reference and the OpenAPI document', () => {
        const orphaned = { ...meta, routes: { ...meta.routes, 'GET /api/v2/gone': { resource: 'pages', stability: 'beta', title: 'Gone', summary: 'Removed.', response: {} } } };
        const grouped = groupRoutes(routes, orphaned);
        expect(grouped.resources[0].routes.map((r) => r.route.key)).toEqual(['GET /api/v2/pages', 'POST /api/v2/pages']);
        expect(Object.keys(openApiOf(grouped, context).paths)).not.toContain('/api/v2/gone');
    });
});

describe('what drift costs', () => {
    const drift = {
        stale: ['out of date: docs/API.md (run npm run api:doc)'],
        orphans: ['GET /api/v2/forms'],
        undescribed: ['DELETE /api/v2/pages/:id'],
    };

    it('is only warnings by default, so a pull request cannot fail on what another one merged', () => {
        expect(driftReport(drift)).toEqual({
            problems: [],
            warnings: [
                'out of date: docs/API.md (run npm run api:doc)',
                'described but no longer registered, left out: GET /api/v2/forms',
                'not described in scripts/api-doc.meta.json, listed as undocumented: DELETE /api/v2/pages/:id',
            ],
        });
    });

    it('fails on stale files and orphan entries when strict, and still only warns about a route with no entry', () => {
        expect(driftReport(drift, true)).toEqual({
            problems: [
                'out of date: docs/API.md (run npm run api:doc)',
                'described but no longer registered, left out: GET /api/v2/forms',
            ],
            warnings: ['not described in scripts/api-doc.meta.json, listed as undocumented: DELETE /api/v2/pages/:id'],
        });
    });

    it('passes a strict check with nothing to report', () => {
        expect(driftReport({ stale: [], orphans: [], undescribed: [] }, true)).toEqual({ problems: [], warnings: [] });
    });
});

describe('one route as markdown', () => {
    const entry = {
        resource: 'tasks',
        stability: 'stable',
        title: 'Create a task',
        summary: 'Creates a task in a project.',
        body: [{ name: 'data.TaskName', type: 'string', required: true, description: 'The task\'s name.' }],
        request: { data: { TaskName: 'Write the release notes', ProjectID: '<project id>' } },
        response: { status: true, statusText: 'Task created successfully.', id: '<task id>' },
        errors: { 400: 'The body is not an object.', 404: 'The project does not exist.' },
    };
    const created = route('POST /api/v2/tasks', { taskNeeds: [{ key: 'task.task_create', write: true }] });
    const text = renderRoute(created, entry, classifyAuth(created, entry, context));

    it('opens with the title, the method and path and the stability', () => {
        expect(text.split('\n').slice(0, 4)).toEqual(['### Create a task', '', '`POST /api/v2/tasks` · stable', '']);
    });

    it('states who may call it and with what', () => {
        expect(text).toContain('| Auth | Session or API token with the `write` scope |');
        expect(text).toContain('| Token limited to projects | Refused |');
        expect(text).toContain('| Permission | `task.task_create` |');
    });

    it('lists the body fields', () => {
        expect(text).toContain('| `data.TaskName` | string | yes | The task\'s name. |');
    });

    it('shows a request with placeholders and never a token', () => {
        expect(text).toContain('POST /api/v2/tasks\nAuthorization: Bearer <token>\ncompanyid: <company id>\nContent-Type: application/json');
        expect(text).toContain('"ProjectID": "<project id>"');
        expect(text).not.toMatch(/ahp_[a-f0-9]{8}/);
    });

    it('shows the response and the errors, the standing ones included', () => {
        expect(text).toContain('"statusText": "Task created successfully."');
        expect(text).toContain('| 400 | The body is not an object. |');
        expect(text).toContain('| 401 |');
        expect(text).toContain('| 403 |');
        expect(text).toContain('| 404 | The project does not exist. |');
        expect(text).toContain('| 429 |');
    });

    it('leaves the request body out of a read with no body', () => {
        const read = route('GET /api/v2/pages/:id');
        const readEntry = { resource: 'pages', stability: 'beta', title: 'Read a page', summary: 'Reads one page.', pathParams: [{ name: 'id', type: 'id', description: 'The page.' }], response: { status: true } };
        const readText = renderRoute(read, readEntry, classifyAuth(read, readEntry, context));
        expect(readText).toContain('GET /api/v2/pages/<id>\nAuthorization: Bearer <token>\ncompanyid: <company id>\n```');
        expect(readText).not.toContain('Content-Type');
        expect(readText).toContain('| `id` | id | The page. |');
        expect(readText).toContain('with the `read` scope');
    });
});

describe('the appendix', () => {
    it('is one row per route with its auth and status', () => {
        const grouped = groupRoutes(routes, meta);
        const lines = renderAppendix(grouped.appendix, context).split('\n');
        expect(lines).toContain('| `GET` | `/api/v2/secrets` | Session | internal | Workspace secrets. |');
        expect(lines).toContain('| `GET` | `/api/v2/forms` | Session or token | undocumented | Lists forms. |');
        expect(lines).toContain('| `GET` | `/api/v1/task/:id` | Session or token | internal | |');
    });
});

describe('the OpenAPI document', () => {
    const withRead = { ...meta, routes: { ...meta.routes, 'GET /api/v2/pages/:id': { stability: 'beta', summary: 'Reads a page.' } } };
    const doc = openApiOf(groupRoutes([...routes, route('GET /api/v2/pages/:id')], withRead), context);

    it('carries the paths, methods, tags and auth of every described route that is not internal', () => {
        expect(doc.openapi).toBe('3.1.0');
        expect(Object.keys(doc.paths)).toEqual(['/api/v2/forms', '/api/v2/pages', '/api/v2/pages/{id}', '/api/v2/tasks']);
        expect(doc.paths['/api/v2/pages'].get).toMatchObject({ summary: 'Lists pages.', tags: ['Pages'], security: [{ apiToken: [], companyId: [] }], 'x-stability': 'beta', 'x-documented': true });
        expect(Object.keys(doc.paths['/api/v2/pages'])).toEqual(['get', 'post']);
        expect(doc.paths['/api/v2/tasks'].post['x-token-scope']).toBe('write');
        expect(doc.paths['/api/v2/forms'].get).toMatchObject({ tags: ['Not documented in full'], 'x-documented': false });
        expect(doc.paths['/api/v2/pages/{id}'].get.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
    });

    it('says what it was built from when told', () => {
        expect(doc.info['x-built-from']).toBeUndefined();
        expect(openApiOf(groupRoutes(routes, meta), context, 'abc123def456').info['x-built-from']).toBe('abc123def456');
    });

    it('leaves out internal routes and routes the meta file does not describe', () => {
        expect(doc.paths['/api/v2/secrets']).toBeUndefined();
        expect(doc.paths['/api/v1/task/{id}']).toBeUndefined();
    });
});

describe('the stale check', () => {
    const files = { '/repo/docs/API.md': 'current\n', '/repo/docs/api/openapi.json': '{}\n' };

    it('passes when the committed files match the generator', () => {
        expect(staleFiles(files, (file) => files[file], '/repo')).toEqual([]);
    });

    it('names a file that differs or is missing', () => {
        const committed = { '/repo/docs/API.md': 'older\n' };
        expect(staleFiles(files, (file) => committed[file], '/repo')).toEqual([
            'out of date: docs/API.md (run npm run api:doc)',
            'out of date: docs/api/openapi.json (run npm run api:doc)',
        ]);
    });
});
