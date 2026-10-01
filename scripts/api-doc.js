#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const META_FILE = path.join(__dirname, 'api-doc.meta.json');
const META_NAME = 'scripts/api-doc.meta.json';
const OUTPUTS = {
    docs: path.join(ROOT, 'docs', 'API.md'),
    openapi: path.join(ROOT, 'docs', 'api', 'openapi.json'),
};
const REGENERATE = 'npm run api:doc';
const DESCRIBED_PREFIX = '/api/v2/';
const WEB_APP_PREFIX = '/api/v1/';
const STABILITIES = ['stable', 'beta', 'internal'];
const INTERNAL = 'internal';
const UNDOCUMENTED = 'undocumented';
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'USE'];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const SAMPLE_ID = 'a'.repeat(24);

const AUTH = Object.freeze({
    PUBLIC: 'public',
    API_TOKEN: 'api-token',
    SESSION_OR_TOKEN: 'session-or-token',
    SESSION: 'session',
    INSTANCE_ADMIN: 'instance-admin',
});

const AUTH_LABEL = Object.freeze({
    [AUTH.PUBLIC]: 'No login guard',
    [AUTH.API_TOKEN]: 'API token',
    [AUTH.SESSION_OR_TOKEN]: 'Session or token',
    [AUTH.SESSION]: 'Session',
    [AUTH.INSTANCE_ADMIN]: 'Instance admin',
});

const samplePathOf = (routePath) => routePath.replace(/:\w+(\([^)]*\))?\??/g, SAMPLE_ID).replace(/\*/g, 'x');
const scopeOf = (method) => (READ_METHODS.includes(method) ? 'read' : 'write');

function classifyAuth(route, entry = {}, context = {}) {
    const closed = { token: false, narrowedToken: false, agentToken: false, scope: null };
    if (route.ownAuth === 'api-token') {
        return { class: AUTH.API_TOKEN, token: true, narrowedToken: true, agentToken: true, scope: scopeOf(route.method), companyHeader: 'required' };
    }
    if (!route.guard) return { class: AUTH.PUBLIC, ...closed, companyHeader: 'none' };
    if (route.guard === 'instance-admin') return { class: AUTH.INSTANCE_ADMIN, ...closed, companyHeader: 'none' };

    const companyHeader = route.guard === 'company' ? 'required' : 'with-token';
    const sample = samplePathOf(route.path);
    const managesTokens = Boolean(context.tokenBlockedPrefix) && sample.startsWith(context.tokenBlockedPrefix) && !(context.tokenAllowedPaths || []).includes(sample);
    if (managesTokens || entry.apiToken === false) return { class: AUTH.SESSION, ...closed, companyHeader };

    return {
        class: AUTH.SESSION_OR_TOKEN,
        token: true,
        narrowedToken: (context.held || []).some((held) => held.methods.includes(route.method) && held.path.test(sample)),
        agentToken: !(route.agentPerimeter && (context.agentPerimeter || []).some((rule) => rule.test(route.method, sample))),
        scope: scopeOf(route.method),
        companyHeader,
    };
}

const isDocumented = (entry) => Boolean(entry && entry.resource);

const byPathThenMethod = (a, b) => (a.route.path === b.route.path
    ? METHOD_ORDER.indexOf(a.route.method) - METHOD_ORDER.indexOf(b.route.method)
    : (a.route.path < b.route.path ? -1 : 1));

function groupRoutes(routes, meta) {
    const byKey = new Map(routes.map((route) => [route.key, route]));
    const documentedKeys = Object.keys(meta.routes).filter((key) => isDocumented(meta.routes[key]) && byKey.has(key));
    const resources = (meta.resources || [])
        .map((resource) => ({
            ...resource,
            routes: documentedKeys.filter((key) => meta.routes[key].resource === resource.id).map((key) => ({ route: byKey.get(key), entry: meta.routes[key] })),
        }))
        .filter((resource) => resource.routes.length);
    const appendix = routes
        .filter((route) => !documentedKeys.includes(route.key))
        .map((route) => {
            const entry = meta.routes[route.key] || null;
            const internal = entry ? entry.stability === INTERNAL : route.path.startsWith(WEB_APP_PREFIX);
            return { route, entry, status: internal ? INTERNAL : UNDOCUMENTED, summary: (entry && entry.summary) || '' };
        })
        .sort(byPathThenMethod);
    return { resources, appendix };
}

function entryProblems(key, entry, resourceIds) {
    if (!STABILITIES.includes(entry.stability)) return [`unknown stability "${entry.stability}": ${key}`];
    if (!isDocumented(entry)) return [];
    if (!resourceIds.includes(entry.resource)) return [`unknown resource "${entry.resource}": ${key}`];
    if (entry.stability === INTERNAL) return [`documented in full but marked internal: ${key}`];
    if (!entry.title || !entry.summary || entry.response === undefined) return [`documented in full but has no title, summary or response: ${key}`];
    return [];
}

function metaProblems(routes, meta) {
    const registered = new Set(routes.map((route) => route.key));
    const resourceIds = (meta.resources || []).map((resource) => resource.id);
    const described = Object.keys(meta.routes).sort();
    return [
        ...routes.map((route) => route.key).filter((key) => key.split(' ')[1].startsWith(DESCRIBED_PREFIX) && !meta.routes[key]).sort()
            .map((key) => `not described in ${META_NAME}: ${key}`),
        ...described.filter((key) => !registered.has(key)).map((key) => `described but no longer registered: ${key}`),
        ...described.filter((key) => registered.has(key)).flatMap((key) => entryProblems(key, meta.routes[key], resourceIds)),
    ];
}

const cell = (text) => String(text === undefined || text === null ? '' : text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (text) => `\`${text}\``;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)];
const INLINE_JSON_WIDTH = 90;
const inlineJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
    if (value !== null && typeof value === 'object') {
        const pairs = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`);
        return pairs.length ? `{ ${pairs.join(', ')} }` : '{}';
    }
    return JSON.stringify(value);
};

/* JSON for reading: a value that fits on one line stays on one line. */
function readableJson(value, indent = '') {
    const inline = inlineJson(value);
    if (value === null || typeof value !== 'object' || indent.length + inline.length <= INLINE_JSON_WIDTH) return inline;
    const inner = `${indent}  `;
    const items = Array.isArray(value)
        ? value.map((item) => `${inner}${readableJson(item, inner)}`)
        : Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${readableJson(item, inner)}`);
    return `${Array.isArray(value) ? '[' : '{'}\n${items.join(',\n')}\n${indent}${Array.isArray(value) ? ']' : '}'}`;
}

const jsonBlock = (value) => ['```json', readableJson(value), '```'];

const authText = (auth) => {
    if (auth.class === AUTH.API_TOKEN) return `API token with the ${code(auth.scope)} scope`;
    if (auth.class === AUTH.SESSION_OR_TOKEN) return `Session or API token with the ${code(auth.scope)} scope`;
    if (auth.class === AUTH.SESSION) return 'Session only; an API token is refused';
    if (auth.class === AUTH.INSTANCE_ADMIN) return 'The instance owner\'s session';
    return 'None';
};

const needLabel = (need) => (need.anyOf ? need.anyOf.map((option) => code(option.key)).join(' or ') : code(need.key));
const needLabels = (needs) => [...new Set(needs.map(needLabel))].join(', ');

const permissionText = (route, entry) => {
    const parts = route.permissions.map(code);
    if (route.taskNeeds) parts.push(needLabels(route.taskNeeds));
    if (route.actions) parts.push('One per action, in the table below');
    if (entry.permission) parts.push(entry.permission);
    return parts.join('. ');
};

const fieldPath = (parts) => parts.map((part) => (part === '*' ? '[]' : part)).join('.').replace(/\.\[\]/g, '[]');

/* One row per action a dispatching task route accepts: the key it needs, the ids it reads and the body keys it keeps. */
function actionRows(actions, pattern, notes = {}) {
    const matches = new RegExp(pattern || '.');
    return actions.filter((action) => matches.test(action.name)).map((action) => [
        code(action.name),
        action.needs ? needLabels(action.needs) : 'Depends on the body',
        action.ids.map((id) => code(fieldPath(id))).join(', '),
        action.params.map((param) => (action.writes[param] ? `${code(param)} (${action.writes[param].map(code).join(', ')})` : code(param))).join(', '),
        notes[action.name] || '',
    ]);
}

const requestPathOf = (route, entry) => entry.requestPath || route.path.replace(/:(\w+)(\([^)]*\))?\??/g, '<$1>');

function requestBlock(route, entry, auth, body) {
    const lines = ['```http', `${route.method} ${requestPathOf(route, entry)}`];
    if (auth.token) lines.push('Authorization: Bearer <token>', 'companyid: <company id>');
    if (body !== undefined && body !== null) lines.push('Content-Type: application/json', '', readableJson(body));
    return [...lines, '```'];
}

const STANDING_ERRORS = Object.freeze({
    401: 'No token, a token that is invalid, expired or revoked, or no valid `companyid` header.',
    429: 'Too many requests from this address. Wait `retryAfter` seconds and send it again.',
});

function forbiddenText(route, auth) {
    const reasons = [`The token lacks the ${code(auth.scope)} scope, or its person is no longer a member of the workspace.`];
    if (!auth.narrowedToken) reasons.push('A token limited to projects is refused here.');
    if (!auth.agentToken) reasons.push('An agent token is refused here.');
    if (route.permissions.length || route.taskNeeds || route.actions) reasons.push('The person\'s role lacks the permission the route needs.');
    return reasons.join(' ');
}

function errorRows(route, entry, auth) {
    const rows = { ...(auth.token ? { ...STANDING_ERRORS, 403: forbiddenText(route, auth) } : {}) };
    Object.entries(entry.errors || {}).forEach(([status, text]) => { rows[status] = rows[status] ? `${rows[status]} ${text}` : text; });
    return Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((status) => [status, rows[status]]);
}

const paramRows = (params) => params.map((param) => [code(param.name), param.type, param.description]);
const fieldRows = (fields) => fields.map((field) => [code(field.name), field.type, field.required ? 'yes' : '', field.description]);

function renderRoute(route, entry, auth) {
    const lines = [`### ${entry.title}`, '', `${code(`${route.method} ${route.path}`)} · ${entry.stability}`, '', entry.summary, ''];
    (entry.description || []).forEach((paragraph) => lines.push(paragraph, ''));

    const who = [['Auth', authText(auth)]];
    if (auth.token) {
        who.push(['Token limited to projects', auth.narrowedToken ? 'Accepted, and held to its projects' : 'Refused']);
        who.push(['Agent token', auth.agentToken ? 'Accepted' : 'Refused']);
    }
    const permission = permissionText(route, entry);
    if (permission) who.push(['Permission', permission]);
    lines.push(...table(['', ''], who), '');

    if (entry.pathParams) lines.push('**Path parameters**', '', ...table(['Name', 'Type', 'Description'], paramRows(entry.pathParams)), '');
    if (entry.query) lines.push('**Query parameters**', '', ...table(['Name', 'Type', 'Required', 'Description'], fieldRows(entry.query)), '');
    if (entry.body) lines.push('**Body**', '', ...table(['Field', 'Type', 'Required', 'Description'], fieldRows(entry.body)), '');
    (entry.bodyNotes || []).forEach((paragraph) => lines.push(paragraph, ''));
    if (route.actions) {
        lines.push('**Actions**', '', ...table(['`action`', 'Permission', 'Ids', 'Body keys kept', 'Notes'], actionRows(route.actions, entry.actionsMatching, entry.actionNotes)), '');
    }

    lines.push('**Request**', '', ...requestBlock(route, entry, auth, entry.request), '');
    lines.push('**Response**', '', ...jsonBlock(entry.response), '');
    (entry.responseNotes || []).forEach((paragraph) => lines.push(paragraph, ''));
    if (entry.responseFields) lines.push(...table(['Field', 'Description'], entry.responseFields.map((field) => [code(field.name), field.description])), '');
    (entry.examples || []).forEach((example) => {
        lines.push(`**Example: ${example.title}**`, '', ...requestBlock(route, { ...entry, requestPath: example.requestPath || entry.requestPath }, auth, example.request), '');
        if (example.response) lines.push(...jsonBlock(example.response), '');
    });
    if (entry.paging) lines.push('**Paging**', '', entry.paging, '');

    const errors = errorRows(route, entry, auth);
    if (errors.length) lines.push('**Errors**', '', ...table(['Status', 'When'], errors), '');
    return lines.join('\n');
}

const APPENDIX_SECTIONS = [
    { title: 'Version 2', test: (routePath) => routePath.startsWith('/api/v2/') },
    { title: 'Version 1 (the web app\'s own API)', test: (routePath) => routePath.startsWith('/api/v1/') },
    { title: 'Everything else', test: () => true },
];

const appendixRow = (item, context) => `| ${code(item.route.method)} | ${code(item.route.path)} | ${AUTH_LABEL[classifyAuth(item.route, item.entry || {}, context).class]} | ${item.status} | ${cell(item.summary)}${item.summary ? ' ' : ''}|`;

function renderAppendix(appendix, context) {
    const lines = [];
    let rest = appendix;
    APPENDIX_SECTIONS.forEach((section) => {
        const rows = rest.filter((item) => section.test(item.route.path));
        rest = rest.filter((item) => !section.test(item.route.path));
        if (!rows.length) return;
        lines.push(`### ${section.title}`, '', '| Method | Path | Auth | Status | Summary |', '|---|---|---|---|---|', ...rows.map((item) => appendixRow(item, context)), '');
    });
    return lines.join('\n');
}

const SECURITY = Object.freeze({
    [AUTH.PUBLIC]: [],
    [AUTH.API_TOKEN]: [{ apiToken: [], companyId: [] }],
    [AUTH.SESSION_OR_TOKEN]: [{ apiToken: [], companyId: [] }],
    [AUTH.SESSION]: [{ session: [] }],
    [AUTH.INSTANCE_ADMIN]: [{ session: [] }],
});

const openApiPath = (routePath) => routePath.replace(/:(\w+)(\([^)]*\))?\??/g, '{$1}');
const pathParamsOf = (routePath) => [...routePath.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));

function operationOf(route, entry, tag, context) {
    const auth = classifyAuth(route, entry, context);
    const parameters = pathParamsOf(route.path);
    return {
        ...(entry.summary ? { summary: entry.summary } : {}),
        tags: [tag],
        security: SECURITY[auth.class],
        ...(parameters.length ? { parameters } : {}),
        responses: { 200: { description: 'The standard response body.' } },
        'x-stability': entry.stability,
        'x-documented': isDocumented(entry),
        ...(auth.scope ? { 'x-token-scope': auth.scope } : {}),
    };
}

const OTHER_TAG = 'Not documented in full';

function openApiOf(grouped, context) {
    const paths = {};
    const add = (route, entry, tag) => {
        if (route.method === 'USE') return;
        const at = openApiPath(route.path);
        paths[at] = { ...(paths[at] || {}), [route.method.toLowerCase()]: operationOf(route, entry, tag, context) };
    };
    grouped.resources.forEach((resource) => resource.routes.forEach(({ route, entry }) => add(route, entry, resource.title)));
    grouped.appendix.filter((item) => item.entry && item.status !== INTERNAL).forEach((item) => add(item.route, item.entry, OTHER_TAG));
    return {
        openapi: '3.1.0',
        info: {
            title: 'AlianHub API',
            version: 'v2',
            description: `Paths, methods, auth and tags only. The full reference is docs/API.md. Generated by ${REGENERATE}.`,
        },
        tags: [...grouped.resources.map((resource) => ({ name: resource.title, description: resource.intro })), { name: OTHER_TAG }],
        paths: Object.fromEntries(Object.keys(paths).sort().map((at) => [at, paths[at]])),
        components: {
            securitySchemes: {
                apiToken: { type: 'http', scheme: 'bearer', description: 'A personal access token.' },
                companyId: { type: 'apiKey', in: 'header', name: 'companyid', description: 'The workspace the request is for.' },
                session: { type: 'apiKey', in: 'cookie', name: 'accessToken', description: 'The web app\'s signed-in session.' },
            },
        },
    };
}

const anchorOf = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

function renderFront(facts, grouped, counts) {
    const { rate, tokens, oauth, webhooks, held } = facts;
    return [
        '# AlianHub API reference',
        '',
        `Generated by \`${REGENERATE}\` from the routes the server registers, the guards they sit behind and \`${META_NAME}\`. Do not edit this file by hand: \`tests/conventions/api-doc.test.js\` fails when it differs from what the generator writes, and when a \`/api/v2\` route has no entry in the meta file.`,
        '',
        `The server registers ${counts.total} routes. ${counts.documented} are documented in full below. The other ${counts.appendix} are listed in the [appendix](#appendix-every-other-route) with their method, path and auth, marked \`${INTERNAL}\` or \`${UNDOCUMENTED}\`, so this page is honest about what it does not cover. A machine-readable list of paths, methods, auth and tags is in \`docs/api/openapi.json\`.`,
        '',
        'Every id, name and token below is a placeholder.',
        '',
        '## Contents',
        '',
        '- [Base URL and versions](#base-url-and-versions)',
        '- [Authentication](#authentication)',
        '- [Responses and errors](#responses-and-errors)',
        '- [Rate limiting](#rate-limiting)',
        '- [Ids and dates](#ids-and-dates)',
        '- [Pagination](#pagination)',
        '- [Webhook deliveries](#webhook-deliveries)',
        '- [Stability](#stability)',
        ...grouped.resources.map((resource) => `- [${resource.title}](#${anchorOf(resource.title)})`),
        '- [Appendix: every other route](#appendix-every-other-route)',
        '',
        '## Base URL and versions',
        '',
        'Every path is relative to the address your AlianHub instance is served from, for example `https://hub.example.com`. There is no separate API host.',
        '',
        '| Prefix | What it is |',
        '|---|---|',
        '| `/api/v2` | The API integrations should use. This reference documents the part of it a token can call. |',
        '| `/api/public-v1` | A small read-only namespace that accepts an API token and nothing else. |',
        '| `/api/v1` | The web app\'s own API. It is listed in the appendix so nothing is hidden, but it follows the web app and may change without notice. |',
        '',
        'Request bodies are JSON (`Content-Type: application/json`). A body larger than the server\'s limit (2 MB unless the instance raises `BODY_LIMIT`) is refused.',
        '',
        '## Authentication',
        '',
        '### Personal access tokens',
        '',
        `A personal access token starts with \`${tokens.prefix}\` and is shown once, when it is created. Send it as a bearer token, together with the id of the workspace the request is for:`,
        '',
        '```http',
        'GET /api/v2/api-tokens/me',
        'Authorization: Bearer <token>',
        'companyid: <company id>',
        '```',
        '',
        'A token acts as the person who created it. It reads what that person can open in the web app and changes what that person\'s role allows; it is never a way past project or sprint visibility. A token stops working on its next call when it is revoked, when it expires, or when its person is removed from the workspace.',
        '',
        'A token is created from a signed-in session, in the web app. A token cannot create, change or delete tokens: the token management routes answer 403 to a token, except `GET /api/v2/api-tokens/me`.',
        '',
        '### The `companyid` header',
        '',
        'A token belongs to one workspace. Every request made with a token carries that workspace\'s id in the `companyid` header, as 24 hexadecimal characters. A missing or malformed header is a 401.',
        '',
        '### Scopes',
        '',
        `A token carries the scopes ${tokens.scopes.map(code).join(' and ')}. \`GET\`, \`HEAD\` and \`OPTIONS\` requests need \`read\`; every other method needs \`write\`, including a \`POST\` that only reads. A token without the scope a request needs gets a 403. A token created with no scopes named holds both.`,
        '',
        '### Tokens limited to projects',
        '',
        'A token can be created limited to some projects. Such a token is refused, with 403 and `code: "token_limited_to_projects"`, on every route that cannot hold it to that list. Of the routes documented here, these accept it:',
        '',
        ...held.map((key) => `- ${code(key)}`),
        '',
        'On those routes it reads only its own projects; a project outside the list answers "not found". Each route below says whether it accepts such a token.',
        '',
        '### Agent tokens',
        '',
        'A token created for an AI agent is an agent token. On top of everything above, an agent token is refused on routes that delete, on the bulk task route, and on billing, member, permission and token management routes. Those refusals are 403 and are recorded in the audit log. Each route below says whether it accepts an agent token.',
        '',
        '### Token lifetime',
        '',
        `A token can be given an expiry of ${tokens.minDays} to ${tokens.maxDays} days when it is created. An instance running with \`API_TOKEN_STRICT\` requires both an expiry and at least one scope, can lower the longest lifetime with \`API_TOKEN_MAX_DAYS\`, and stops tokens that have no expiry ${tokens.graceDays} days after strict mode began (or after the token was created, if later). Without strict mode a token with no expiry keeps working until it is revoked.`,
        '',
        '### OAuth',
        '',
        `OAuth is offered for the MCP endpoint (\`/mcp\`) when the instance turns \`MCP_OAUTH\` on, and only there: an OAuth access token is not accepted by the REST routes in this reference. Its scopes are ${oauth.scopes.map(code).join(', ')}. By default an access token lasts ${oauth.accessMinutes} minutes, a refresh token ${oauth.refreshDays} days and a grant at most ${oauth.grantDays} days. See \`docs/MCP-AGENT-GUIDE.md\`.`,
        '',
        '## Responses and errors',
        '',
        'A success is a JSON object with `status: true`, a human-readable `statusText`, and the result in `data`:',
        '',
        '```json',
        readableJson({ status: true, statusText: 'Pages fetched.', data: [] }),
        '```',
        '',
        'A few routes put a value beside `data` instead of inside it (a new task\'s `id`, a list\'s `hasMore`); each route below shows its own response.',
        '',
        'A failure is a JSON object with `status: false` and the reason in `statusText`, `message` or both:',
        '',
        '```json',
        readableJson({ status: false, statusText: 'Page not found.' }),
        '```',
        '',
        'Some failures add `error`, a machine-readable `code`, the `permission` key that was missing, or the `field` that was refused.',
        '',
        '**Status codes.** The web app expects HTTP 200 on a handled failure and reads `status` from the body. A request made with an API token gets a real status code instead: when a handler answers 200 with `status: false`, the server changes the status line to the matching 4xx and adds the header `X-Status-Mapped: 1`. The body is not changed. Any other caller can ask for the same with the header `Prefer: status-codes`. The code is the handler\'s own `statusCode` when it sets one, and is otherwise read from the text: "not found" is 404, a permission refusal is 403, "already" or "duplicate" is 409, a token or session problem is 401, and anything else is 400. Check `status` in the body as well as the status code.',
        '',
        '| Status | Meaning |',
        '|---|---|',
        '| 400 | The request was refused: a missing or malformed field, an unknown key, a value out of range. |',
        '| 401 | No token, a token that is invalid, expired or revoked, or no valid `companyid` header. |',
        '| 403 | The token lacks the scope, the person\'s role lacks the permission, or the token may not use the route. |',
        '| 404 | The thing does not exist, or the caller may not see it. The two are answered alike on purpose. |',
        '| 409 | The request conflicts with what is stored. |',
        `| 429 | Rate limited. See [Rate limiting](#rate-limiting). |`,
        '| 500 | The server failed. The body carries `status: false`. |',
        '',
        '## Rate limiting',
        '',
        `There is one limit per client address, across all API routes: ${rate.perMinute} requests per ${rate.windowSeconds} seconds unless the instance sets \`GLOBAL_RATE_LIMIT_PER_MIN\` (which can also turn it off). Static files are not counted. A request over the limit is answered with 429, a \`Retry-After\` header in seconds, and:`,
        '',
        '```json',
        readableJson({ status: false, code: rate.code, statusText: rate.text, message: rate.text, retryAfter: 12 }),
        '```',
        '',
        'On a 429, wait `retryAfter` seconds and send the same request again. The response headers `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` show where the caller stands.',
        '',
        '## Ids and dates',
        '',
        'An id is 24 hexadecimal characters, sent and returned as a string. A value that is not a well-formed id where one is expected is a 400, or reads as "not found".',
        '',
        'A date is returned as an ISO 8601 string in UTC, for example `2026-10-01T09:30:00.000Z`. Where a route accepts a date it accepts an ISO 8601 string; a route that also accepts a time in milliseconds says so.',
        '',
        'Field names are the stored ones and are not uniform: a task carries `TaskName`, `ProjectID` and `Task_Priority` beside `sprintId` and `statusKey`. Use the names exactly as each route shows them.',
        '',
        '## Pagination',
        '',
        'Three styles are in use. Each route says which one it follows.',
        '',
        '| Style | How it works | Used by |',
        '|---|---|---|',
        '| Cursor | Send the `nextCursor` of the page before as `cursor`. `nextCursor` is `null` on the last page. | `POST /api/v2/tasks/everything` |',
        '| Skip and limit | Send `skip` and `limit`. The response carries `hasMore` and `nextSkip`. | `GET /api/v2/webhooks/:id/logs` |',
        '| Limit only | Send `limit`, up to the route\'s cap. The newest rows come first and there is no next page. | `GET /api/public-v1/tasks`, `GET /api/v2/agents/runs`, `GET /api/v2/agents/proposals` |',
        '',
        'Routes that are not in this table return the whole list.',
        '',
        '## Webhook deliveries',
        '',
        `A webhook posts task events to a URL you choose. The events are ${webhooks.events.map(code).join(', ')}; \`*\` subscribes to all of them. The formats are ${webhooks.formats.map(code).join(', ')}. Webhooks are managed with the routes under [Webhooks](#webhooks).`,
        '',
        'A delivery in the `json` format is a `POST` with this body:',
        '',
        '```json',
        readableJson({
            event: 'task.updated',
            companyId: '<company id>',
            deliveredAt: '2026-10-01T09:30:00.000Z',
            changedFields: ['Task_Priority'],
            data: { _id: '<task id>', TaskKey: 'WEB-12', TaskName: 'Write the release notes', statusType: 'active', Task_Priority: 'HIGH', ProjectID: '<project id>', sprintId: '<list id>', AssigneeUserId: ['<user id>'], assigneeNames: ['Sample Person'], updatedAt: '2026-10-01T09:30:00.000Z' },
        }),
        '```',
        '',
        '`data` is a fixed set of task fields, never the whole stored task. `previous` is added, with the same shape, when the server has delivered this task before. Each delivery carries the headers `X-AlianHub-Event`, `X-AlianHub-Delivery-Attempt` and `X-AlianHub-Signature`. The signature is `sha256=` followed by the HMAC-SHA256 of the raw request body, keyed with the secret returned when the webhook was created; compute it over the bytes received and compare before trusting a delivery. Changes to one task within a couple of seconds arrive as one delivery. A delivery that fails with a network error or a 5xx is sent once more, 30 seconds later.',
        '',
        '## Stability',
        '',
        '| Mark | Meaning |',
        '|---|---|',
        '| `stable` | Meant to be relied on. The request and response shapes shown here are not expected to change. |',
        '| `beta` | Usable, but the shape may still change with the feature it serves. |',
        `| \`${INTERNAL}\` | For the web app, instance administration or sign-in. Not for integrations; it may change at any time. |`,
        `| \`${UNDOCUMENTED}\` | Not described in full yet. It appears in the appendix only. |`,
        '',
    ];
}

function renderDocs(grouped, context, facts) {
    const documented = grouped.resources.reduce((sum, resource) => sum + resource.routes.length, 0);
    const counts = { documented, appendix: grouped.appendix.length, total: documented + grouped.appendix.length };
    const lines = renderFront(facts, grouped, counts);
    grouped.resources.forEach((resource) => {
        lines.push(`## ${resource.title}`, '', resource.intro, '');
        (resource.notes || []).forEach((paragraph) => lines.push(paragraph, ''));
        resource.routes.forEach(({ route, entry }) => lines.push(renderRoute(route, entry, classifyAuth(route, entry, context))));
    });
    lines.push(
        '## Appendix: every other route',
        '',
        `Every route the server registers that is not documented in full above, with every optional module switched on. \`${INTERNAL}\` routes are not for integrations; every \`/api/v1\` route is one unless the meta file says otherwise. \`${UNDOCUMENTED}\` routes have no description here yet; nothing about them is promised.`,
        '',
        'The Auth column is the guard the route sits behind. `Session or token` routes accept the web app\'s session or an API token. `Session` routes refuse a token. `Instance admin` routes are for the person who runs the server. `No login guard` routes are sign-in and sign-up, pages opened by a secret link, and endpoints that check a credential of their own, such as `/mcp` and `/scim/v2`. A handler can refuse more than its guard does.',
        '',
        renderAppendix(grouped.appendix, context),
    );
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function staleFiles(files, read, root = ROOT) {
    return Object.entries(files)
        .filter(([file, content]) => read(file) !== content)
        .map(([file]) => `out of date: ${path.relative(root, file)} (run ${REGENERATE})`);
}

const loadMeta = () => JSON.parse(fs.readFileSync(META_FILE, 'utf8'));

const isActionTable = (taskWrites) => Boolean(taskWrites) && !Object.hasOwn(taskWrites, 'needs');

/* The task write table says which key an action needs; the field specs say which body keys it keeps. An action with no
 * field spec is refused by the handler, so it is left out. */
function taskActionsOf(taskWrites, fieldSpecs) {
    return Object.entries(taskWrites).filter(([name, action]) => fieldSpecs[action.method || name]).map(([name, action]) => {
        const spec = fieldSpecs[action.method || name];
        return {
            name,
            needs: typeof action.needs === 'function' ? null : action.needs,
            ids: spec.ids,
            params: spec.params.filter((param) => !spec.actor.includes(param)),
            writes: spec.writes,
        };
    });
}

function collect({ stub = true, intervals = [] } = {}) {
    const walk = require('./route-walk');
    Object.assign(process.env, walk.WALK_ENV);
    if (stub) walk.stubSideEffects();
    const app = walk.buildApp({ intervals });
    const walked = walk.listRoutes(app).routes;

    const jwt = require('../Config/jwt');
    const { HELD_ROUTES } = require('../Config/narrowedTokenRoutes');
    const { tokenAuth } = require('../Modules/ApiTokens/publicApi');
    const { agentPerimeter, PERIMETER } = require('../Modules/Agents/guard');
    const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
    const tokenRules = require('../Modules/ApiTokens/helpers/apiTokenRules');
    const rateLimit = require('../Config/globalRateLimit');
    const oauth = require('../Modules/OAuthServer/config');
    const webhookRules = require('../Modules/Webhooks/helpers/webhookRules');

    const perimeterAt = app._router.stack.findIndex((layer) => layer.handle === agentPerimeter);
    const routes = walked.map((route) => ({
        key: route.key,
        method: route.method,
        path: route.path,
        guard: route.guard,
        source: route.source,
        ownAuth: route.handles.includes(tokenAuth) ? 'api-token' : null,
        agentPerimeter: perimeterAt !== -1 && route.at > perimeterAt,
        permissions: route.permissions,
        taskNeeds: route.taskWrites && Array.isArray(route.taskWrites.needs) ? route.taskWrites.needs : null,
        actions: isActionTable(route.taskWrites) ? taskActionsOf(route.taskWrites, TASK_ACTION_FIELDS) : null,
    }));
    const context = {
        held: HELD_ROUTES,
        tokenBlockedPrefix: jwt.PAT_BLOCKED_PATH_PREFIX,
        tokenAllowedPaths: jwt.PAT_ALLOWED_EXCEPTIONS,
        agentPerimeter: PERIMETER,
    };
    const facts = {
        rate: { perMinute: rateLimit.DEFAULT_PER_MIN, windowSeconds: rateLimit.WINDOW_MS / 1000, code: rateLimit.BUSY_CODE, text: rateLimit.BUSY_TEXT },
        tokens: { prefix: tokenRules.TOKEN_PREFIX, scopes: [...tokenRules.SCOPES], minDays: tokenRules.MIN_EXPIRY_DAYS, maxDays: tokenRules.MAX_EXPIRY_DAYS, graceDays: tokenRules.STRICT_GRACE_DAYS },
        oauth: { scopes: [...oauth.SCOPES], accessMinutes: oauth.DEFAULTS.accessTokenMinutes, refreshDays: oauth.DEFAULTS.refreshTokenDays, grantDays: oauth.DEFAULTS.grantMaxDays },
        webhooks: { events: [...webhookRules.EVENT_TYPES], formats: [...webhookRules.WEBHOOK_FORMATS] },
    };
    return { routes, context, facts };
}

function build(options) {
    const meta = loadMeta();
    const { routes, context, facts } = collect(options);
    const problems = metaProblems(routes, meta);
    if (problems.length) return { problems, routes };

    const grouped = groupRoutes(routes, meta);
    facts.held = grouped.resources.flatMap((resource) => resource.routes)
        .filter(({ route, entry }) => classifyAuth(route, entry, context).narrowedToken).map(({ route }) => route.key);
    return {
        problems,
        routes,
        grouped,
        files: {
            [OUTPUTS.docs]: renderDocs(grouped, context, facts),
            [OUTPUTS.openapi]: `${JSON.stringify(openApiOf(grouped, context), null, 2)}\n`,
        },
    };
}

const readOrNull = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function check(built = build()) {
    return built.problems.length ? built.problems : staleFiles(built.files, readOrNull);
}

function main(argv) {
    const built = build();
    if (built.problems.length || argv.includes('--check')) {
        const problems = check(built);
        problems.forEach((problem) => process.stderr.write(`${problem}\n`));
        process.stderr.write(problems.length ? `${problems.length} problem(s)\n` : 'the api reference is in sync\n');
        return problems.length ? 1 : 0;
    }
    for (const [file, content] of Object.entries(built.files)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        process.stdout.write(`wrote ${path.relative(ROOT, file)}\n`);
    }
    return 0;
}

// Loading every module leaves timers and scheduled jobs behind, so the process is ended rather than left to drain.
if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { AUTH, classifyAuth, groupRoutes, metaProblems, actionRows, renderRoute, renderAppendix, renderDocs, openApiOf, staleFiles, loadMeta, collect, build, check };
